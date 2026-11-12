// Routes des scripts : liste enrichie, détail, création/édition (YAML + code), suppression, lancement, environnement.
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config, paths } from '../config.js';
import fsp from 'node:fs/promises';
import type { ScriptRecord } from '../db/repo.js';
import { parseSpec, SpecError, validateSpec, ScheduleSchema, isValidSlug } from '../core/spec.js';
import { nextOccurrences, ScheduleError, validateCron } from '../core/schedule.js';
import { ensureDir } from '../util/fs.js';
import { newId } from '../util/ids.js';
import type { ParamValues } from '../core/params.js';

export function enrich(app: FastifyInstance, s: ScriptRecord) {
  const { repo, scheduler } = app.services;
  const last = repo.lastRun(s.slug);
  const running = repo.runningRuns(s.slug);
  const next = scheduler.nextFor(s.slug);
  return {
    slug: s.slug,
    name: s.name,
    group: s.group,
    status: s.status,
    spec_error: s.spec_error,
    env_status: s.env_status,
    env_updated_at: s.env_updated_at,
    missing_since: s.missing_since,
    spec: s.spec,
    last_run: last
      ? { id: last.id, status: last.status, started_at: last.started_at, finished_at: last.finished_at, exit_code: last.exit_code, trigger: last.trigger }
      : null,
    running: running.map((r) => ({ id: r.id, started_at: r.started_at })),
    next_runs: next,
    queued: repo.listQueue(s.slug).length,
  };
}

export async function registerScriptRoutes(app: FastifyInstance): Promise<void> {
  const { repo, registry, orchestrator, envs, scheduler } = app.services;

  app.get('/api/scripts', async () => ({
    scripts: repo.listScripts().map((s) => enrich(app, s)),
    scriptsDirAvailable: registry.dirAvailable(),
    stats: repo.runStats(),
  }));

  app.post('/api/scripts/reload', async () => {
    await registry.reloadAll();
    return { ok: true };
  });

  app.get('/api/scripts/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const s = repo.getScript(slug);
    if (!s) return reply.code(404).send({ error: 'Script inconnu' });
    return {
      ...enrich(app, s),
      yaml: registry.readYaml(slug),
      code: registry.readScriptFile(slug, s.spec.file),
      env_log: s.env_log,
      env_fingerprint: s.env_fingerprint,
      queue: repo.listQueue(slug),
    };
  });

  const SaveBody = z.object({
    spec: z.any().optional(),
    yaml: z.string().optional(),
    code: z.string().nullable().optional(),
  });

  /** Création ou mise à jour : soit `spec` (objet), soit `yaml` (texte brut) ; `code` facultatif. */
  app.put('/api/scripts/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!isValidSlug(slug)) return reply.code(400).send({ error: 'Identifiant invalide : minuscules, chiffres, tirets' });
    const body = SaveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Corps invalide' });
    try {
      let spec;
      let yamlText: string | null = null;
      if (body.data.yaml !== undefined) {
        spec = parseSpec(body.data.yaml);
        yamlText = body.data.yaml;
      } else if (body.data.spec !== undefined) {
        spec = validateSpec(body.data.spec);
      } else return reply.code(400).send({ error: '`spec` ou `yaml` requis' });
      for (const sch of spec.schedules) {
        const err = validateCron(sch.cron);
        if (err) throw new SpecError(`Planification ${sch.id} : expression cron invalide (${err})`);
      }
      const rec = await registry.save(slug, spec, body.data.code, yamlText);
      return enrich(app, rec);
    } catch (e) {
      if (e instanceof SpecError) return reply.code(422).send({ error: e.message, issues: e.issues });
      throw e;
    }
  });

  app.delete('/api/scripts/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!repo.getScript(slug)) return reply.code(404).send({ error: 'Script inconnu' });
    if (repo.runningRuns(slug).length) return reply.code(409).send({ error: 'Un run est en cours' });
    await registry.remove(slug);
    return { ok: true };
  });

  /** Lancement manuel / API : JSON { params } ou multipart (fichiers téléversés). */
  app.post('/api/scripts/:slug/run', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const s = repo.getScript(slug);
    if (!s) return reply.code(404).send({ error: 'Script inconnu' });
    let params: ParamValues = {};
    if (req.isMultipart()) {
      const uploadDir = path.join(paths.uploads, newId());
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          ensureDir(uploadDir);
          const safe = path.basename(part.filename || part.fieldname).replace(/[^\w.\-]+/g, '_');
          const dest = path.join(uploadDir, safe);
          await new Promise<void>((res, rej) => {
            const ws = fs.createWriteStream(dest);
            part.file.pipe(ws).on('finish', () => res()).on('error', rej);
          });
          params[part.fieldname] = dest;
        } else {
          const v = part.value as string;
          // Les multi-choix arrivent en JSON ; les autres en texte.
          try {
            params[part.fieldname] = v.startsWith('[') ? JSON.parse(v) : v;
          } catch {
            params[part.fieldname] = v;
          }
        }
      }
    } else {
      const body = z.object({ params: z.record(z.any()).optional() }).safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'Corps invalide' });
      params = body.data.params ?? {};
    }
    const out = await orchestrator.launch({ slug, trigger: req.authKind === 'token' ? 'api' : 'manual', params });
    if (out.outcome === 'rejected') return reply.code(409).send({ error: out.reason, outcome: out.outcome });
    if (out.outcome === 'skipped') return reply.code(200).send({ outcome: 'skipped', reason: out.reason, run: out.run });
    if (out.outcome === 'queued') return reply.code(202).send({ outcome: 'queued', queueId: out.queueId });
    return reply.code(201).send({ outcome: 'started', run: out.run });
  });

  app.post('/api/scripts/:slug/env/rebuild', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const s = repo.getScript(slug);
    if (!s) return reply.code(404).send({ error: 'Script inconnu' });
    envs.ensure(s, true);
    return { ok: true };
  });

  app.delete('/api/scripts/:slug/queue', async (req) => {
    const { slug } = req.params as { slug: string };
    return { removed: repo.clearQueue(slug) };
  });

  /** Aperçu des prochaines occurrences d'une planification (sans l'enregistrer). */
  app.post('/api/schedules/preview', async (req, reply) => {
    const body = ScheduleSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join(' ; ') });
    try {
      const dates = nextOccurrences({ ...body.data, id: 'preview' }, new Date(), 5, app.services.settings.get().timezone);
      return { next: dates.map((d) => d.toISOString()) };
    } catch (e) {
      if (e instanceof ScheduleError) return reply.code(422).send({ error: e.message });
      throw e;
    }
  });

  app.get('/api/schedules', async () => {
    const out: unknown[] = [];
    for (const s of repo.listScripts()) {
      const next = Object.fromEntries(scheduler.nextFor(s.slug).map((n) => [n.scheduleId, n.nextAt]));
      for (const sch of s.spec.schedules) {
        const st = repo.getScheduleState(s.slug, sch.id!);
        out.push({ slug: s.slug, script_name: s.name, group: s.group, schedule: sch, next_at: next[sch.id!] ?? null, last_fired_at: st?.last_fired_at ?? null, active: s.status === 'ok' && s.spec.enabled && sch.enabled });
      }
    }
    return { schedules: out };
  });

  /** Explorateur du dossier des scripts (lecture seule) : ?path=<relatif> → dossiers et fichiers. */
  app.get('/api/browse', async (req, reply) => {
    const q = req.query as { path?: string };
    const rel = (q.path ?? '').split('\\').join('/').replace(/^\/+|\/+$/g, '');
    const root = path.resolve(config.scriptsDir);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) return reply.code(400).send({ error: 'Chemin hors du dossier des scripts' });
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      return reply.code(404).send({ error: 'Dossier introuvable ou inaccessible' });
    }
    const items = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(abs, e.name);
      let size = 0;
      let mtime: string | null = null;
      try {
        const st = await fsp.stat(p);
        size = st.size;
        mtime = st.mtime.toISOString();
      } catch {
        continue;
      }
      items.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', size, mtime, declared: e.isDirectory() && fs.existsSync(path.join(p, 'script.yaml')) });
    }
    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return { path: rel, items };
  });

  /** Contenu texte d'un fichier du dossier des scripts (1 Mo maximum). */
  app.get('/api/browse/file', async (req, reply) => {
    const q = req.query as { path?: string };
    const rel = (q.path ?? '').split('\\').join('/').replace(/^\/+/, '');
    const root = path.resolve(config.scriptsDir);
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) return reply.code(400).send({ error: 'Chemin hors du dossier des scripts' });
    try {
      const st = await fsp.stat(abs);
      if (!st.isFile()) return reply.code(400).send({ error: 'Pas un fichier' });
      if (st.size > 1024 * 1024) return reply.code(413).send({ error: 'Fichier trop volumineux pour l’éditeur (1 Mo max)' });
      const buf = await fsp.readFile(abs);
      if (buf.includes(0)) return reply.code(415).send({ error: 'Fichier binaire' });
      return { path: rel, content: buf.toString('utf8') };
    } catch {
      return reply.code(404).send({ error: 'Fichier introuvable' });
    }
  });

  app.get('/api/groups', async () => {
    const groups = new Set<string>();
    for (const s of repo.listScripts()) if (s.group) groups.add(s.group);
    return { groups: [...groups].sort() };
  });
}
