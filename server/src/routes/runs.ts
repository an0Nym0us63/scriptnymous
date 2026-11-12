// Routes des runs : historique filtrable, détail, journal par tranche, arrêt, suppression.
import type { FastifyInstance } from 'fastify';
import fsp from 'node:fs/promises';
import { readLogSlice } from '../services/logs.js';
import { bus } from '../core/events.js';

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  const { repo, orchestrator } = app.services;

  app.get('/api/runs', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
    const offset = Math.max(0, Number(q.offset ?? 0) || 0);
    const filter = { slug: q.slug || undefined, status: q.status || undefined, trigger: q.trigger || undefined };
    return { runs: repo.listRuns({ ...filter, limit, offset }), total: repo.countRuns(filter), limit, offset };
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = repo.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Run inconnu' });
    return { run, script: repo.getScript(run.script_slug) ? { name: run.script_name, slug: run.script_slug } : null };
  });

  /** Journal : ?from=<octets> pour la suite, ?tail=1 pour les derniers 512 Ko. */
  app.get('/api/runs/:id/log', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = repo.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Run inconnu' });
    if (!run.log_path) return { text: '', offset: 0, size: 0, status: run.status };
    const q = req.query as { from?: string; tail?: string; max?: string };
    const slice = await readLogSlice(run.log_path, Number(q.from ?? 0) || 0, Math.min(2 * 1024 * 1024, Number(q.max ?? 0) || 512 * 1024), q.tail === '1');
    return { ...slice, status: run.status };
  });

  app.get('/api/runs/:id/log/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = repo.getRun(id);
    if (!run?.log_path) return reply.code(404).send({ error: 'Journal introuvable' });
    try {
      const data = await fsp.readFile(run.log_path);
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${run.script_slug}-${run.id}.log"`)
        .send(data);
    } catch {
      return reply.code(404).send({ error: 'Journal introuvable' });
    }
  });

  app.post('/api/runs/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = orchestrator.stopRun(id);
    if (!r.ok) return reply.code(409).send({ error: r.reason });
    return { ok: true };
  });

  app.delete('/api/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = repo.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Run inconnu' });
    if (run.status === 'running') return reply.code(409).send({ error: 'Le run est en cours' });
    if (run.log_path) await fsp.rm(run.log_path, { force: true });
    repo.deleteRun(id);
    bus.emit('run:updated', { run: { ...run, status: 'skipped' } });
    return { ok: true };
  });

  app.get('/api/queue', async () => ({ queue: repo.listQueue() }));
  app.delete('/api/queue/:id', async (req) => {
    const { id } = req.params as { id: string };
    repo.dequeue(id);
    return { ok: true };
  });
}
