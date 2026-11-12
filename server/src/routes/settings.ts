// Routes des réglages : lecture/écriture, test ntfy, purge manuelle, notifications récentes, informations système.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config, paths } from '../config.js';
import { purgeLogs } from '../services/logs.js';
import { dirSizeBytes } from '../util/fs.js';

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  const { settings, notifier, repo, registry } = app.services;

  app.get('/api/settings', async () => ({
    settings: settings.getPublic(),
    system: {
      version: process.env.npm_package_version ?? '0.1.0',
      node: process.version,
      platform: process.platform,
      scriptsDir: config.scriptsDir,
      scriptsDirAvailable: registry.dirAvailable(),
      dataDir: config.dataDir,
      logsBytes: await dirSizeBytes(paths.logs),
      envsBytes: await dirSizeBytes(paths.envs),
      publicUrlFromEnv: !!config.publicUrl,
    },
  }));

  const Body = z.object({
    ntfy_server: z.string().optional(),
    ntfy_topic: z.string().optional(),
    ntfy_token: z.string().nullable().optional(),
    public_url: z.string().optional(),
    log_retention_days: z.number().int().min(0).optional(),
    log_max_mb: z.number().int().min(0).optional(),
    orphan_policy: z.enum(['kill', 'adopt']).optional(),
    timezone: z.string().optional(),
    variables_file: z.string().optional(),
  });

  app.put('/api/settings', async (req, reply) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; ') });
    const patch = { ...body.data } as Record<string, string | number | null | undefined>;
    // Jeton : chaîne vide = inchangé ; null = effacer.
    if (patch.ntfy_token === '') delete patch.ntfy_token;
    if (patch.public_url) patch.public_url = String(patch.public_url).replace(/\/$/, '');
    if (patch.timezone) {
      try {
        new Intl.DateTimeFormat('fr-FR', { timeZone: String(patch.timezone) });
      } catch {
        return reply.code(400).send({ error: 'Fuseau horaire inconnu' });
      }
    }
    if (typeof patch.variables_file === 'string') {
      const rel = patch.variables_file.split('\\').join('/').replace(/^\/+/, '').trim();
      if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '')) return reply.code(400).send({ error: 'Chemin du fichier de variables invalide (relatif au dossier des scripts)' });
      patch.variables_file = rel;
    }
    settings.update(patch);
    // Le fuseau impacte les planifications : on réarme tout.
    for (const s of repo.listScripts()) app.services.scheduler.rearm(s);
    return { settings: settings.getPublic() };
  });

  app.post('/api/settings/ntfy/test', async () => notifier.test());

  app.post('/api/settings/purge', async () => {
    const s = settings.get();
    return purgeLogs(repo, { retentionDays: s.log_retention_days, maxMb: s.log_max_mb }, app.log);
  });

  app.get('/api/notifications', async () => ({ notifications: repo.listNotifications(50) }));
}
