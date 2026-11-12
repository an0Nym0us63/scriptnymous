// Routes de la mini-app d'un script : tables (CRUD générique), fichiers de données, sous-app HTML servie en même origine.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppDbError, appFilesDir } from '../core/appdb.js';
import { bus } from '../core/events.js';
import { ensureDir } from '../util/fs.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};

export async function registerAppRoutes(app: FastifyInstance): Promise<void> {
  const { repo, appdb, registry } = app.services;

  /** Vérifie que l'appelant a le droit d'écrire sur ce script (session, jeton d'API, ou jeton du run de ce script). */
  const guard = (req: FastifyRequest, reply: FastifyReply, slug: string): boolean => {
    if (req.authKind === 'run' && req.runSlug !== slug) {
      void reply.code(403).send({ error: 'Le jeton de run ne donne accès qu’aux données de son propre script' });
      return false;
    }
    return true;
  };
  const script = (slug: string, reply: FastifyReply) => {
    const s = repo.getScript(slug);
    if (!s) void reply.code(404).send({ error: 'Script inconnu' });
    return s;
  };
  const onError = (e: unknown, reply: FastifyReply) => {
    if (e instanceof AppDbError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  /** Résumé : configuration de l'app et statistiques de chaque table. */
  app.get('/api/scripts/:slug/app', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const s = script(slug, reply);
    if (!s) return;
    if (!s.spec.app) return { app: null, tables: {} };
    appdb.ensure(slug, s.spec.app);
    const tables: Record<string, unknown> = {};
    for (const name of Object.keys(s.spec.app.tables)) tables[name] = appdb.stats(slug, s.spec.app, name);
    return { app: s.spec.app, tables, page: s.spec.app.page ? `/api/scripts/${encodeURIComponent(slug)}/app/page/` : null };
  });

  app.get('/api/scripts/:slug/db/:table', async (req, reply) => {
    const { slug, table } = req.params as { slug: string; table: string };
    const s = script(slug, reply);
    if (!s || !guard(req, reply, slug)) return;
    const q = { ...(req.query as Record<string, string>) };
    const { q: search, sort, limit, offset, ...filters } = q;
    try {
      appdb.ensure(slug, s.spec.app);
      return appdb.list(slug, s.spec.app, table, { filters, q: search, sort, limit: Number(limit) || undefined, offset: Number(offset) || undefined });
    } catch (e) {
      return onError(e, reply);
    }
  });

  app.get('/api/scripts/:slug/db/:table/stats', async (req, reply) => {
    const { slug, table } = req.params as { slug: string; table: string };
    const s = script(slug, reply);
    if (!s || !guard(req, reply, slug)) return;
    try {
      appdb.ensure(slug, s.spec.app);
      return appdb.stats(slug, s.spec.app, table);
    } catch (e) {
      return onError(e, reply);
    }
  });

  app.get('/api/scripts/:slug/db/:table/:key', async (req, reply) => {
    const { slug, table, key } = req.params as { slug: string; table: string; key: string };
    const s = script(slug, reply);
    if (!s || !guard(req, reply, slug)) return;
    try {
      const r = appdb.get(slug, s.spec.app, table, key);
      return r ?? reply.code(404).send({ error: 'Ligne inconnue' });
    } catch (e) {
      return onError(e, reply);
    }
  });

  const Rows = z.union([z.array(z.record(z.any())).max(5000), z.object({ rows: z.array(z.record(z.any())).max(5000) })]);

  /** Insertion ou mise à jour (par la clé déclarée) : une ligne, une liste, ou { rows: [...] }. */
  app.post('/api/scripts/:slug/db/:table', async (req, reply) => {
    const { slug, table } = req.params as { slug: string; table: string };
    const s = script(slug, reply);
    if (!s || !guard(req, reply, slug)) return;
    const raw = Array.isArray(req.body) || (req.body && typeof req.body === 'object' && 'rows' in (req.body as object)) ? req.body : [req.body];
    const body = Rows.safeParse(raw);
    if (!body.success) return reply.code(400).send({ error: 'Corps attendu : un objet, une liste d’objets ou { rows: [...] }' });
    const rows = Array.isArray(body.data) ? body.data : body.data.rows;
    try {
      appdb.ensure(slug, s.spec.app);
      const r = appdb.upsert(slug, s.spec.app, table, rows, req.runId ?? null);
      bus.emit('app:changed', { slug, table });
      return r;
    } catch (e) {
      return onError(e, reply);
    }
  });

  app.patch('/api/scripts/:slug/db/:table/:key', async (req, reply) => {
    const { slug, table, key } = req.params as { slug: string; table: string; key: string };
    const s = script(slug, reply);
    if (!s || !guard(req, reply, slug)) return;
    const body = z.record(z.any()).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Objet JSON attendu' });
    try {
      const ok = appdb.patch(slug, s.spec.app, table, key, body.data);
      bus.emit('app:changed', { slug, table });
      return ok ? { ok: true } : reply.code(404).send({ error: 'Ligne inconnue' });
    } catch (e) {
      return onError(e, reply);
    }
  });

  app.delete('/api/scripts/:slug/db/:table/:key', async (req, reply) => {
    const { slug, table, key } = req.params as { slug: string; table: string; key: string };
    const s = script(slug, reply);
    if (!s || !guard(req, reply, slug)) return;
    try {
      const ok = appdb.delete(slug, s.spec.app, table, key);
      bus.emit('app:changed', { slug, table });
      return ok ? { ok: true } : reply.code(404).send({ error: 'Ligne inconnue' });
    } catch (e) {
      return onError(e, reply);
    }
  });

  /** Suppression par filtre (?status=pending) ; sans filtre, vide la table. */
  app.delete('/api/scripts/:slug/db/:table', async (req, reply) => {
    const { slug, table } = req.params as { slug: string; table: string };
    const s = script(slug, reply);
    if (!s || !guard(req, reply, slug)) return;
    try {
      const removed = appdb.deleteWhere(slug, s.spec.app, table, req.query as Record<string, string>);
      bus.emit('app:changed', { slug, table });
      return { removed };
    } catch (e) {
      return onError(e, reply);
    }
  });

  // ---- fichiers de données (/data/apps/<slug>/files) ----
  const safeFile = (root: string, rel: string): string | null => {
    const p = path.resolve(root, rel);
    return p.startsWith(root + path.sep) || p === root ? p : null;
  };

  app.get('/api/scripts/:slug/files/*', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const rel = (req.params as { '*': string })['*'];
    const p = safeFile(appFilesDir(slug), rel);
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) return reply.code(404).send({ error: 'Introuvable' });
    return reply.header('Content-Type', MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream').header('Cache-Control', 'private, max-age=3600').send(fs.createReadStream(p));
  });

  /** Dépôt d'un fichier (corps brut) : utile aux scripts qui ne tournent pas sur la même machine. */
  app.put('/api/scripts/:slug/files/*', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!script(slug, reply) || !guard(req, reply, slug)) return;
    const rel = (req.params as { '*': string })['*'];
    const root = appFilesDir(slug);
    const p = safeFile(root, rel);
    if (!p || p === root) return reply.code(400).send({ error: 'Chemin invalide' });
    ensureDir(path.dirname(p));
    const body = req.body as Buffer | string | undefined;
    await fsp.writeFile(p, typeof body === 'string' ? body : Buffer.isBuffer(body) ? body : JSON.stringify(body ?? ''));
    return { ok: true, url: `/api/scripts/${encodeURIComponent(slug)}/files/${rel}` };
  });

  app.delete('/api/scripts/:slug/files/*', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!script(slug, reply) || !guard(req, reply, slug)) return;
    const p = safeFile(appFilesDir(slug), (req.params as { '*': string })['*']);
    if (!p) return reply.code(400).send({ error: 'Chemin invalide' });
    await fsp.rm(p, { force: true, recursive: false });
    return { ok: true };
  });

  // ---- sous-app HTML servie depuis le dossier du script ----
  app.get('/api/scripts/:slug/app/page/*', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const s = repo.getScript(slug);
    if (!s?.spec.app?.page) return reply.code(404).send({ error: 'Ce script n’a pas de sous-app' });
    const pageAbs = path.resolve(registry.scriptDir(slug), s.spec.app.page);
    const root = path.dirname(pageAbs);
    let rel = (req.params as { '*': string })['*'] || '';
    if (!rel || rel.endsWith('/')) rel = path.join(rel, path.basename(pageAbs));
    const p = safeFile(root, rel);
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) return reply.code(404).send({ error: 'Introuvable' });
    return reply
      .header('Content-Type', MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream')
      .header('Cache-Control', 'no-cache')
      .send(fs.createReadStream(p));
  });
}
