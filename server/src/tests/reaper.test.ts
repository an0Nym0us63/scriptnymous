// Rapprochement au démarrage : run « en cours » sans processus → perdu ; processus factice vivant → tué (politique kill).
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { Reaper } from '../core/reaper.js';
import { Runner } from '../core/runner.js';
import { memRepo, silentLogger, waitFor } from './helpers.js';
import { pidAlive, readProcStartTicks, isLinux } from '../core/proc.js';
import type { RunRow } from '../db/repo.js';

const children: ReturnType<typeof spawn>[] = [];
afterAll(() => {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {
      /* déjà mort */
    }
  }
});

function fakeRun(id: string, pid: number | null, ticks: string | null): RunRow {
  const t = new Date().toISOString();
  return {
    id, script_slug: 's', script_name: 'S', trigger: 'manual', schedule_id: null, params_json: '{}', status: 'running',
    exit_code: null, signal: null, pid, pgid: pid, proc_start_ticks: ticks, attempt: 1, max_attempts: 1, parent_run_id: null,
    queued_at: null, started_at: t, finished_at: null, heartbeat_at: t, log_path: null, log_bytes: 0, error: null, created_at: t,
  };
}

describe('rapprochement des fantômes', () => {
  it('marque perdu un run dont le pid n’existe plus', () => {
    const repo = memRepo();
    const runner = new Runner(repo);
    // pid très improbable
    repo.insertRun(fakeRun('dead', 999_999, null));
    const reaper = new Reaper(repo, runner, { orphanPolicy: () => 'kill', graceSeconds: 1 }, silentLogger());
    const res = reaper.reconcile();
    expect(res.lost).toBe(1);
    expect(repo.getRun('dead')!.status).toBe('lost');
  });

  it('tue un processus factice encore vivant (politique kill)', async () => {
    const repo = memRepo();
    const runner = new Runner(repo);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: !process.platform.startsWith('win') });
    children.push(child);
    await waitFor(() => pidAlive(child.pid!));
    repo.insertRun(fakeRun('alive', child.pid!, readProcStartTicks(child.pid!)));
    const reaper = new Reaper(repo, runner, { orphanPolicy: () => 'kill', graceSeconds: 1 }, silentLogger());
    const res = reaper.reconcile();
    expect(res.killed).toBe(1);
    expect(repo.getRun('alive')!.status).toBe('killed');
    await waitFor(() => !pidAlive(child.pid!), 5_000);
  });

  it('adopte un processus vivant puis le marque terminé à sa fin (politique adopt)', async () => {
    const repo = memRepo();
    const runner = new Runner(repo);
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: 'ignore' });
    children.push(child);
    await waitFor(() => pidAlive(child.pid!));
    repo.insertRun(fakeRun('adopt', child.pid!, readProcStartTicks(child.pid!)));
    const reaper = new Reaper(repo, runner, { orphanPolicy: () => 'adopt', graceSeconds: 1 }, silentLogger());
    expect(reaper.reconcile().adopted).toBe(1);
    expect(repo.getRun('adopt')!.status).toBe('running');
    await waitFor(() => repo.getRun('adopt')!.status === 'lost', 15_000);
    reaper.stop();
  });

  it.runIf(isLinux)('détecte une réutilisation de pid grâce au starttime', () => {
    expect(readProcStartTicks(process.pid)).toMatch(/^\d+$/);
  });
});
