// Remises à zéro : historique (par script, par statut, global), notifications, file, données d'une mini-app.
import { describe, expect, it } from 'vitest';
import { memRepo } from './helpers.js';
import { purgeRuns, resetAppData, resetGlobal, parseStatusFilter, FAILED_STATUSES } from '../services/reset.js';
import { AppDbManager } from '../core/appdb.js';
import { parseSpec } from '../core/spec.js';
import type { RunRow } from '../db/repo.js';

const run = (id: string, slug: string, status: string): RunRow =>
  ({
    id, script_slug: slug, script_name: slug, trigger: 'manual', schedule_id: null, params_json: '{}', status, exit_code: status === 'success' ? 0 : 1,
    signal: null, pid: null, pgid: null, proc_start_ticks: null, attempt: 1, max_attempts: 1, parent_run_id: null, queued_at: null,
    started_at: '2026-01-01T00:00:00Z', finished_at: status === 'running' ? null : '2026-01-01T00:01:00Z', heartbeat_at: null, log_path: null, log_bytes: 0, error: null,
    created_at: '2026-01-01T00:00:00Z',
  }) as unknown as RunRow;

describe('remises à zéro', () => {
  it('purge par script et par statut, sans toucher aux runs en cours', async () => {
    const repo = memRepo();
    for (const [id, slug, st] of [['a1', 'a', 'success'], ['a2', 'a', 'failed'], ['a3', 'a', 'running'], ['b1', 'b', 'timeout'], ['b2', 'b', 'success']] as const) repo.insertRun(run(id, slug, st));
    expect((await purgeRuns(repo, { slug: 'a', statuses: FAILED_STATUSES })).removed).toBe(1);
    expect(repo.getRun('a2')).toBeNull();
    expect(repo.getRun('a1')).not.toBeNull();
    expect((await purgeRuns(repo, { slug: 'a' })).removed).toBe(1); // a1 ; a3 tourne encore
    expect(repo.getRun('a3')).not.toBeNull();
    expect((await purgeRuns(repo)).removed).toBe(2); // b1 + b2
    expect(repo.countRuns()).toBe(1);
  });

  it('parseStatusFilter : « failed » couvre tous les échecs', () => {
    expect(parseStatusFilter('failed')).toEqual(FAILED_STATUSES);
    expect(parseStatusFilter('success, skipped')).toEqual(['success', 'skipped']);
    expect(parseStatusFilter(undefined)).toBeUndefined();
  });

  it('remise à zéro globale : notifications et file', async () => {
    const repo = memRepo();
    repo.logNotification('a', null, 'failure', 'x', true, null);
    repo.enqueue({ id: 'q1', script_slug: 'a', trigger: 'retry', schedule_id: null, params_json: '{}', attempt: 2, parent_run_id: null, not_before: null, created_at: '2026-01-01T00:00:00Z' });
    const r = await resetGlobal(repo, { notifications: true, queue: true });
    expect(r).toEqual({ runs: 0, notifications: 1, queue: 1 });
    expect(repo.listNotifications()).toHaveLength(0);
    expect(repo.listQueue()).toHaveLength(0);
  });

  it('données d’une mini-app : tables vidées, table inconnue refusée', async () => {
    const mgr = new AppDbManager();
    const spec = parseSpec(`name: T\ninterpreter: bash\nfile: a.sh\napp:\n  tables:\n    items: { key: id, columns: { id: text!, status: text } }\n    log: { columns: { msg: text } }\n`);
    const slug = 'reset-app-' + Date.now().toString(36);
    mgr.ensure(slug, spec.app);
    mgr.upsert(slug, spec.app, 'items', [{ id: '1', status: 'ok' }, { id: '2', status: 'ko' }], null);
    mgr.upsert(slug, spec.app, 'log', [{ msg: 'x' }], null);
    await expect(resetAppData(mgr, slug, spec.app, { tables: ['nope'] })).rejects.toThrow(/inconnue/);
    const r = await resetAppData(mgr, slug, spec.app, { tables: ['items'] });
    expect(r.tables).toEqual({ items: 2 });
    expect(mgr.list(slug, spec.app, 'log').total).toBe(1);
    expect((await resetAppData(mgr, slug, spec.app)).tables).toEqual({ items: 0, log: 1 });
    mgr.close(slug);
  });
});
