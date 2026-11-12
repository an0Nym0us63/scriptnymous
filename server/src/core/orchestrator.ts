// Orchestrateur : point d'entrée de tout lancement. Applique l'état du script, l'environnement,
// la politique de concurrence, la file d'attente persistante, les retries et les notifications.
import type { FastifyBaseLogger } from 'fastify';
import type { Repo, RunRow, ScriptRecord, Trigger } from '../db/repo.js';
import { bus } from './events.js';
import { decideConcurrency } from './concurrency.js';
import { maskSecrets, ParamError, resolveParams, type ParamValues } from './params.js';
import { retryDelayMs, shouldRetry } from './retry.js';
import type { Runner } from './runner.js';
import type { EnvManager } from './envs.js';
import type { Notifier } from '../services/ntfy.js';
import { newId } from '../util/ids.js';
import { hasDeps } from './spec.js';

export interface LaunchRequest {
  slug: string;
  trigger: Trigger;
  params?: ParamValues;
  scheduleId?: string | null;
  attempt?: number;
  parentRunId?: string | null;
  /** Valeurs déjà résolues (reprise depuis la file) : pas de nouvelle validation. */
  resolved?: boolean;
}

export type LaunchOutcome =
  | { outcome: 'started'; run: RunRow }
  | { outcome: 'skipped'; run: RunRow; reason: string }
  | { outcome: 'queued'; queueId: string }
  | { outcome: 'rejected'; reason: string };

export class Orchestrator {
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private readonly waitingKill = new Map<string, LaunchRequest>();
  // Valeurs réelles (secrets compris) des runs vivants, pour les retries ; jamais écrites en base.
  private readonly valuesByRun = new Map<string, ParamValues>();
  private queueTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly runner: Runner,
    private readonly envs: EnvManager,
    private readonly notifier: Notifier,
    private readonly log: FastifyBaseLogger,
  ) {
    bus.on('run:finished', ({ run }) => void this.onFinished(run));
  }

  start(): void {
    // Les éléments différés (retry) ont une date `not_before` : on les vérifie régulièrement.
    this.queueTimer = setInterval(() => this.drainAll(), 5_000);
    this.drainAll();
  }

  stop(): void {
    if (this.queueTimer) clearInterval(this.queueTimer);
    for (const t of this.pendingTimers.values()) clearTimeout(t);
  }

  /** Lance (ou met en file, ou ignore) selon la politique du script. */
  async launch(req: LaunchRequest): Promise<LaunchOutcome> {
    const script = this.repo.getScript(req.slug);
    if (!script) return { outcome: 'rejected', reason: 'Script inconnu' };
    if (script.status === 'missing') {
      await this.notifier.notify('missing', script, null, 'Lancement refusé : le script est introuvable dans le dossier des scripts.');
      return { outcome: 'rejected', reason: 'Script introuvable dans le dossier des scripts' };
    }
    if (script.status === 'invalid') return { outcome: 'rejected', reason: `Déclaration invalide : ${script.spec_error}` };
    if (!script.spec.enabled && req.trigger === 'schedule') return { outcome: 'rejected', reason: 'Script désactivé' };
    if (hasDeps(script.spec.deps) && !this.envs.isReady(script)) {
      if (script.env_status === 'error') return { outcome: 'rejected', reason: 'Environnement en erreur : consulter le journal d’installation' };
      this.envs.ensure(script);
      return { outcome: 'rejected', reason: `Environnement non prêt (${script.env_status === 'installing' ? 'installation en cours' : 'en attente'})` };
    }

    let values: ParamValues;
    try {
      values = req.resolved ? (req.params ?? {}) : resolveParams(script.spec, req.params);
    } catch (e) {
      if (e instanceof ParamError) return { outcome: 'rejected', reason: e.message };
      throw e;
    }

    const running = this.repo.runningRuns(script.slug);
    const decision = decideConcurrency(script.spec.concurrency, running.length);
    const attempt = req.attempt ?? 1;
    const maxAttempts = script.spec.retry.attempts;

    switch (decision) {
      case 'skip': {
        const run = this.recordSkipped(script, req, values, attempt, maxAttempts, `Une instance est déjà en cours (${running[0].id})`);
        await this.notifier.notify('already_running', script, run, 'Lancement ignoré : une instance tourne encore.');
        return { outcome: 'skipped', run, reason: 'Une instance est déjà en cours' };
      }
      case 'queue': {
        const queueId = newId();
        this.repo.enqueue({
          id: queueId,
          script_slug: script.slug,
          trigger: req.trigger,
          schedule_id: req.scheduleId ?? null,
          params_json: JSON.stringify(values),
          attempt,
          parent_run_id: req.parentRunId ?? null,
          not_before: null,
          created_at: new Date().toISOString(),
        });
        bus.emit('queue:changed', { slug: script.slug });
        await this.notifier.notify('already_running', script, null, 'Lancement mis en file : une instance tourne encore.');
        return { outcome: 'queued', queueId };
      }
      case 'kill_then_start': {
        // On arrête l'ancienne instance ; le lancement reprend à sa fin (voir onFinished).
        for (const r of running) this.runner.stop(r.id, 'killed');
        this.waitingKill.set(script.slug, { ...req, params: values, resolved: true, attempt });
        return { outcome: 'rejected', reason: 'Instance précédente en cours d’arrêt ; le nouveau lancement suivra' };
      }
      case 'start':
        return { outcome: 'started', run: this.startRun(script, req, values, attempt, maxAttempts) };
    }
  }

  private startRun(script: ScriptRecord, req: LaunchRequest, values: ParamValues, attempt: number, maxAttempts: number): RunRow {
    const now = new Date().toISOString();
    const run: RunRow = {
      id: newId(),
      script_slug: script.slug,
      script_name: script.spec.name,
      trigger: req.trigger,
      schedule_id: req.scheduleId ?? null,
      params_json: JSON.stringify(maskSecrets(script.spec, values)),
      status: 'running',
      exit_code: null,
      signal: null,
      pid: null,
      pgid: null,
      proc_start_ticks: null,
      attempt,
      max_attempts: maxAttempts,
      parent_run_id: req.parentRunId ?? null,
      queued_at: null,
      started_at: null,
      finished_at: null,
      heartbeat_at: null,
      log_path: null,
      log_bytes: 0,
      error: null,
      created_at: now,
    };
    this.repo.insertRun(run);
    this.valuesByRun.set(run.id, values);
    bus.emit('run:created', { run });
    void this.notifier.notify('start', script, run);
    this.runner.start(script, run, values);
    return this.repo.getRun(run.id)!;
  }

  private recordSkipped(script: ScriptRecord, req: LaunchRequest, values: ParamValues, attempt: number, maxAttempts: number, reason: string): RunRow {
    const now = new Date().toISOString();
    const run: RunRow = {
      id: newId(),
      script_slug: script.slug,
      script_name: script.spec.name,
      trigger: req.trigger,
      schedule_id: req.scheduleId ?? null,
      params_json: JSON.stringify(maskSecrets(script.spec, values)),
      status: 'skipped',
      exit_code: null,
      signal: null,
      pid: null,
      pgid: null,
      proc_start_ticks: null,
      attempt,
      max_attempts: maxAttempts,
      parent_run_id: req.parentRunId ?? null,
      queued_at: null,
      started_at: now,
      finished_at: now,
      heartbeat_at: null,
      log_path: null,
      log_bytes: 0,
      error: reason,
      created_at: now,
    };
    this.repo.insertRun(run);
    bus.emit('run:created', { run });
    bus.emit('run:updated', { run });
    return run;
  }

  /** Arrêt demandé par l'utilisateur. */
  stopRun(runId: string): { ok: boolean; reason?: string } {
    const run = this.repo.getRun(runId);
    if (!run) return { ok: false, reason: 'Run inconnu' };
    if (run.status !== 'running') return { ok: false, reason: 'Le run n’est pas en cours' };
    if (!this.runner.stop(runId, 'killed')) {
      // Run « en cours » en base mais inconnu du lanceur (après redémarrage) : le rapprochement le traitera.
      return { ok: false, reason: 'Processus non suivi par ce service (rapprochement en attente)' };
    }
    return { ok: true };
  }

  private async onFinished(run: RunRow): Promise<void> {
    const script = this.repo.getScript(run.script_slug);
    const values = this.valuesByRun.get(run.id) ?? (JSON.parse(run.params_json) as ParamValues);
    this.valuesByRun.delete(run.id);
    if (!script) return;

    // 1. Retry.
    if (shouldRetry(script.spec.retry, run.attempt, run.status, run.exit_code)) {
      const next = run.attempt + 1;
      const delay = retryDelayMs(script.spec.retry, next);
      const notBefore = new Date(Date.now() + delay).toISOString();
      await this.notifier.notify('failure', script, run, `Nouvel essai ${next}/${run.max_attempts} dans ${Math.round(delay / 1000)} s.`);
      this.repo.enqueue({
        id: newId(),
        script_slug: script.slug,
        trigger: 'retry',
        schedule_id: run.schedule_id,
        params_json: JSON.stringify(values),
        attempt: next,
        parent_run_id: run.parent_run_id ?? run.id,
        not_before: notBefore,
        created_at: new Date().toISOString(),
      });
      bus.emit('queue:changed', { slug: script.slug });
      this.log.info({ run: run.id, next, delay }, 'Retry programmé');
    } else if (run.status === 'success') {
      await this.notifier.notify('success', script, run);
    } else if (run.status === 'lost') {
      await this.notifier.notify('lost', script, run, 'Le processus a disparu pendant un arrêt du service.');
    } else if (run.status !== 'skipped') {
      const final = run.max_attempts > 1 ? 'final_failure' : 'failure';
      await this.notifier.notify(final, script, run, run.max_attempts > 1 ? `Échec après ${run.attempt} essai(s).` : undefined);
      if (final === 'final_failure') await this.notifier.notify('failure', script, run);
    }

    // 2. Lancement différé par la politique `kill`.
    const pending = this.waitingKill.get(script.slug);
    if (pending) {
      this.waitingKill.delete(script.slug);
      await this.launch(pending);
      return;
    }

    // 3. File d'attente.
    this.drain(script.slug);
  }

  /** Lance le prochain élément en file d'un script si possible. */
  drain(slug: string): void {
    const script = this.repo.getScript(slug);
    if (!script) return;
    const running = this.repo.runningRuns(slug).length;
    if (running > 0 && script.spec.concurrency !== 'parallel') return;
    const item = this.repo.nextQueued(slug, new Date().toISOString());
    if (!item) return;
    this.repo.dequeue(item.id);
    bus.emit('queue:changed', { slug });
    const params = JSON.parse(item.params_json) as ParamValues;
    void this.launch({
      slug,
      trigger: item.trigger === 'retry' ? 'retry' : item.trigger,
      params,
      scheduleId: item.schedule_id,
      attempt: item.attempt,
      parentRunId: item.parent_run_id,
      resolved: true,
    }).then((o) => {
      if (o.outcome === 'rejected') this.log.warn({ slug, reason: o.reason }, 'Élément de file rejeté');
    });
  }

  drainAll(): void {
    for (const slug of this.repo.queuedSlugs()) this.drain(slug);
  }
}
