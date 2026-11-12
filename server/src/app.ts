// Assemblage de l'application : services, hooks d'authentification, routes, fichiers statiques.
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { openDatabase, type DB } from './db/database.js';
import { Repo } from './db/repo.js';
import { Runner } from './core/runner.js';
import { EnvManager } from './core/envs.js';
import { Orchestrator } from './core/orchestrator.js';
import { Scheduler } from './core/scheduler.js';
import { Reaper } from './core/reaper.js';
import { Registry } from './core/registry.js';
import { Notifier } from './services/ntfy.js';
import { SettingsService } from './services/settings.js';
import { AuthService } from './services/auth.js';
import { purgeLogs } from './services/logs.js';
import { loggerOptions } from './util/log.js';
import { ensureDir } from './util/fs.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerScriptRoutes } from './routes/scripts.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerWsRoutes } from './routes/ws.js';
import { registerActivityRoutes } from './routes/activity.js';

export interface Services {
  db: DB;
  repo: Repo;
  runner: Runner;
  envs: EnvManager;
  orchestrator: Orchestrator;
  scheduler: Scheduler;
  reaper: Reaper;
  registry: Registry;
  notifier: Notifier;
  settings: SettingsService;
  auth: AuthService;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
  interface FastifyRequest {
    authKind?: 'session' | 'token';
    sessionId?: string;
  }
}

export const SESSION_COOKIE = 'sn_session';

export async function buildApp(): Promise<FastifyInstance> {
  for (const p of Object.values(paths)) if (!p.endsWith('.db')) ensureDir(p);
  ensureDir(config.dataDir);

  const app = Fastify({ logger: loggerOptions, trustProxy: true, bodyLimit: 10 * 1024 * 1024 });
  const log = app.log;

  const db = openDatabase(paths.db);
  const repo = new Repo(db);
  const settings = new SettingsService(repo);
  const auth = new AuthService(repo, log);
  auth.bootstrap();
  const notifier = new Notifier(repo, settings, log);
  const runner = new Runner(repo);
  const envs = new EnvManager(repo, log);
  const orchestrator = new Orchestrator(repo, runner, envs, notifier, log);
  const scheduler = new Scheduler(repo, orchestrator, () => settings.get().timezone, log);
  const reaper = new Reaper(repo, runner, { orphanPolicy: () => settings.get().orphan_policy, graceSeconds: config.killGraceSeconds }, log);
  const registry = new Registry(repo, log, {
    onMissing: (script) => {
      scheduler.rearm(script);
      void notifier.notify('missing', script, null, `Le dossier ${script.slug} a disparu du partage des scripts ; planifications suspendues.`);
    },
    onChanged: (script) => {
      scheduler.rearm(script);
      if (script.status === 'ok') envs.ensure(script);
    },
  });

  app.decorate('services', { db, repo, runner, envs, orchestrator, scheduler, reaper, registry, notifier, settings, auth });

  await app.register(cookie, { secret: auth.sessionSecret() });
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 10 } });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // ---- Authentification : tout /api sauf login et /healthz. ----
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    if (url === '/api/auth/login' || url === '/api/auth/status') return;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      if (auth.validApiToken(header.slice(7))) {
        req.authKind = 'token';
        return;
      }
      return reply.code(401).send({ error: 'Jeton invalide' });
    }
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value && auth.validSession(unsigned.value)) {
        req.authKind = 'session';
        req.sessionId = unsigned.value;
        return;
      }
    }
    return reply.code(401).send({ error: 'Non authentifié' });
  });

  app.get('/healthz', async () => ({
    ok: true,
    scriptsDir: registry.dirAvailable(),
    running: repo.runningRuns().length,
    uptime: Math.round(process.uptime()),
  }));

  await registerAuthRoutes(app);
  await registerScriptRoutes(app);
  await registerRunRoutes(app);
  await registerSettingsRoutes(app);
  await registerWsRoutes(app);
  await registerActivityRoutes(app);

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) log.error({ err, url: req.url }, 'Erreur serveur');
    reply.code(status).send({ error: err.message });
  });

  // ---- Interface compilée (SPA) : fichiers statiques + repli sur index.html. ----
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/', cacheControl: true, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Introuvable' });
      // Un fichier manquant (ancien bundle en cache, par exemple) ne doit pas recevoir index.html.
      if (/\.[a-z0-9]{1,8}(\?|$)/i.test(req.url)) return reply.code(404).send('Introuvable');
      // index.html et sw.js ne doivent pas être mis en cache par le navigateur.
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html', config.webDist, { cacheControl: false });
    });
  } else {
    log.warn({ dir: config.webDist }, 'Interface compilée absente : seule l’API est servie (en dev, utiliser Vite sur le port 5173)');
  }

  // ---- Démarrage des services de fond. ----
  app.addHook('onReady', async () => {
    await registry.reloadAll();
    const scripts = repo.listScripts();
    await envs.installAptUnion(scripts);
    for (const s of scripts) if (s.status === 'ok') envs.ensure(s);
    reaper.reconcile();
    reaper.start(config.reaperSeconds);
    scheduler.start(scripts);
    orchestrator.start();
    registry.start();
    const purge = () => {
      const s = settings.get();
      void purgeLogs(repo, { retentionDays: s.log_retention_days, maxMb: s.log_max_mb }, log);
    };
    purge();
    const purgeTimer = setInterval(purge, 3600_000);
    app.addHook('onClose', async () => {
      clearInterval(purgeTimer);
      scheduler.stop();
      reaper.stop();
      orchestrator.stop();
      await registry.stop();
      runner.stopAll();
      db.close();
    });
    log.info({ scripts: scripts.length, scriptsDir: config.scriptsDir, dataDir: config.dataDir }, 'ScriptNymous prêt');
  });

  return app;
}
