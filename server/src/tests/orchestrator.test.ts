// Épreuves d'intégration : lanceur réel (scripts Node, portables), concurrence, retry, arrêt, délai maximum.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Orchestrator } from '../core/orchestrator.js';
import { Runner } from '../core/runner.js';
import { EnvManager } from '../core/envs.js';
import { Notifier } from '../services/ntfy.js';
import { SettingsService } from '../services/settings.js';
import { memRepo, silentLogger, sleep, waitFor, writeScript } from './helpers.js';
import type { Repo } from '../db/repo.js';
import fs from 'node:fs';

let repo: Repo;
let orch: Orchestrator;
let runner: Runner;

const yaml = (extra: string) => `name: Test\ninterpreter: node\nfile: script.js\n${extra}`;

beforeAll(() => {
  repo = memRepo();
  const log = silentLogger();
  runner = new Runner(repo);
  const settings = new SettingsService(repo);
  orch = new Orchestrator(repo, runner, new EnvManager(repo, log), new Notifier(repo, settings, log), log);
  writeScript(repo, 'ok', yaml('params:\n  - name: who\n    default: monde\n'), "console.log('bonjour ' + process.argv[2]); process.exit(0);");
  writeScript(repo, 'slow', yaml('concurrency: skip\n'), 'setTimeout(() => console.log("fin"), 1500);');
  writeScript(repo, 'queued', yaml('concurrency: queue\n'), 'setTimeout(() => console.log("fin"), 600);');
  writeScript(repo, 'flaky', yaml('retry:\n  attempts: 2\n  delay_seconds: 0\n'), 'process.exit(3);');
  writeScript(repo, 'timeout', yaml('timeout_seconds: 1\n'), 'setInterval(() => {}, 1000);');
  writeScript(repo, 'killer', yaml('concurrency: kill\n'), 'setInterval(() => {}, 1000);');
});

afterAll(() => {
  orch.stop();
  runner.stopAll();
});

describe('orchestrateur', () => {
  it('lance un script avec paramètre et capture la sortie', async () => {
    const out = await orch.launch({ slug: 'ok', trigger: 'manual', params: { who: 'toi' } });
    expect(out.outcome).toBe('started');
    if (out.outcome !== 'started') return;
    await waitFor(() => repo.getRun(out.run.id)!.status !== 'running');
    const run = repo.getRun(out.run.id)!;
    expect(run.status).toBe('success');
    expect(run.exit_code).toBe(0);
    expect(fs.readFileSync(run.log_path!, 'utf8')).toContain('bonjour toi');
  });

  it('politique skip : la seconde demande est ignorée et tracée', async () => {
    const a = await orch.launch({ slug: 'slow', trigger: 'manual' });
    expect(a.outcome).toBe('started');
    const b = await orch.launch({ slug: 'slow', trigger: 'schedule' });
    expect(b.outcome).toBe('skipped');
    if (b.outcome === 'skipped') expect(b.run.status).toBe('skipped');
    await waitFor(() => repo.runningRuns('slow').length === 0);
  });

  it('politique queue : la seconde demande attend puis s’exécute', async () => {
    const a = await orch.launch({ slug: 'queued', trigger: 'manual' });
    const b = await orch.launch({ slug: 'queued', trigger: 'manual' });
    expect(a.outcome).toBe('started');
    expect(b.outcome).toBe('queued');
    expect(repo.listQueue('queued')).toHaveLength(1);
    await waitFor(() => repo.listRuns({ slug: 'queued', status: 'success' }).length === 2, 10_000);
    expect(repo.listQueue('queued')).toHaveLength(0);
  });

  it('retry : un échec programme un second essai lié au premier', async () => {
    const a = await orch.launch({ slug: 'flaky', trigger: 'manual' });
    expect(a.outcome).toBe('started');
    if (a.outcome !== 'started') return;
    await waitFor(() => repo.listQueue('flaky').length === 1 || repo.listRuns({ slug: 'flaky' }).length === 2);
    orch.drainAll();
    await waitFor(() => repo.listRuns({ slug: 'flaky', status: 'failed' }).length === 2, 10_000);
    const runs = repo.listRuns({ slug: 'flaky' });
    const second = runs.find((r) => r.attempt === 2)!;
    expect(second.trigger).toBe('retry');
    expect(second.parent_run_id).toBe(a.run.id);
    expect(second.exit_code).toBe(3);
    await sleep(200);
    expect(repo.listQueue('flaky')).toHaveLength(0); // plus d'essai après le second
  });

  it('délai maximum : le processus est tué et le run marqué timeout', async () => {
    const a = await orch.launch({ slug: 'timeout', trigger: 'manual' });
    if (a.outcome !== 'started') throw new Error(a.outcome);
    await waitFor(() => repo.getRun(a.run.id)!.status !== 'running', 15_000);
    expect(repo.getRun(a.run.id)!.status).toBe('timeout');
  });

  it('arrêt manuel : statut killed, pas de retry', async () => {
    const a = await orch.launch({ slug: 'killer', trigger: 'manual' });
    if (a.outcome !== 'started') throw new Error(a.outcome);
    await sleep(200);
    expect(orch.stopRun(a.run.id).ok).toBe(true);
    await waitFor(() => repo.getRun(a.run.id)!.status !== 'running', 15_000);
    expect(repo.getRun(a.run.id)!.status).toBe('killed');
  });

  it('politique kill : la nouvelle demande arrête l’ancienne puis démarre', async () => {
    const a = await orch.launch({ slug: 'killer', trigger: 'manual' });
    if (a.outcome !== 'started') throw new Error(a.outcome);
    await sleep(200);
    const b = await orch.launch({ slug: 'killer', trigger: 'manual' });
    expect(b.outcome).toBe('rejected'); // différé : démarre à la fin de l'ancienne
    await waitFor(() => repo.getRun(a.run.id)!.status === 'killed', 15_000);
    await waitFor(() => repo.runningRuns('killer').length === 1, 5_000);
    const fresh = repo.runningRuns('killer')[0];
    expect(fresh.id).not.toBe(a.run.id);
    orch.stopRun(fresh.id);
    await waitFor(() => repo.runningRuns('killer').length === 0, 15_000);
  });

  it('refuse un script introuvable', async () => {
    repo.markScriptMissing('ok');
    const out = await orch.launch({ slug: 'ok', trigger: 'manual' });
    expect(out.outcome).toBe('rejected');
  });
});
