// Activité en cours (panneau « Activité ») et suggestions de dépendances.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { suggestFromCode, suggestFromLog, type DepSuggestion } from '../core/deps-suggest.js';

export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  const { repo } = app.services;

  /** Tout ce qui « tourne » en arrière-plan : installations d'environnement, runs, file d'attente et retries différés. */
  app.get('/api/activity', async () => {
    const scripts = repo.listScripts();
    const names = new Map(scripts.map((s) => [s.slug, s.name]));
    const installs = scripts
      .filter((s) => s.env_status === 'installing' || s.env_status === 'pending')
      .map((s) => ({ slug: s.slug, name: s.name, status: s.env_status, since: s.env_updated_at, log_tail: (s.env_log ?? '').slice(-1500) }));
    const running = repo.runningRuns().map((r) => ({ id: r.id, slug: r.script_slug, name: r.script_name, started_at: r.started_at, trigger: r.trigger, attempt: r.attempt, max_attempts: r.max_attempts }));
    const queue = repo.listQueue().map((q) => ({ id: q.id, slug: q.script_slug, name: names.get(q.script_slug) ?? q.script_slug, trigger: q.trigger, attempt: q.attempt, not_before: q.not_before, created_at: q.created_at }));
    return { installs, running, queue, count: installs.length + running.length + queue.length };
  });

  const Body = z.object({ interpreter: z.string().optional(), code: z.string().optional(), log: z.string().optional() });

  /** Suggestions de dépendances d'après le code et/ou un journal d'échec. */
  app.post('/api/deps/suggest', async (req, reply) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Corps invalide' });
    const out: DepSuggestion[] = [];
    const seen = new Set<string>();
    const add = (list: DepSuggestion[]) => {
      for (const s of list) {
        const k = `${s.kind}:${s.package}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
      }
    };
    // Les erreurs observées d'abord (plus fiables), puis l'analyse du code.
    if (body.data.log) add(suggestFromLog(body.data.log.slice(-200_000)));
    if (body.data.code) add(suggestFromCode(body.data.interpreter, body.data.code.slice(0, 500_000)));
    return { suggestions: out };
  });
}
