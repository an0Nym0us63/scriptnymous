// Rapprochement et fantômes : au démarrage, compare les runs « en cours » avec les processus réels ;
// périodiquement, tue les processus survivants d'un groupe dont le run est terminé.
import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import type { Repo, RunRow } from '../db/repo.js';
import { bus } from './events.js';
import { isSameProcess, killGroup, pidAlive, pidsInGroup } from './proc.js';
import type { Runner } from './runner.js';

export interface ReaperOptions {
  orphanPolicy: () => 'kill' | 'adopt';
  graceSeconds: number;
}

export class Reaper {
  private timer: NodeJS.Timeout | null = null;
  private readonly adopted = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly repo: Repo,
    private readonly runner: Runner,
    private readonly opts: ReaperOptions,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** À appeler une fois au démarrage, avant le planificateur. */
  reconcile(): { lost: number; killed: number; adopted: number } {
    const res = { lost: 0, killed: 0, adopted: 0 };
    for (const run of this.repo.runningRuns()) {
      if (this.runner.isLive(run.id)) continue;
      const alive = run.pid !== null && isSameProcess(run.pid, run.proc_start_ticks);
      if (!alive) {
        this.markLost(run, 'Processus disparu pendant un arrêt du service');
        res.lost++;
        continue;
      }
      if (this.opts.orphanPolicy() === 'adopt') {
        this.adopt(run);
        res.adopted++;
      } else {
        this.appendLog(run, `[scriptnymous] service redémarré : processus ${run.pid} encore vivant, arrêt (politique kill)\n`);
        killGroup(run.pid!, run.pgid, 'SIGTERM');
        setTimeout(() => {
          if (pidAlive(run.pid!)) killGroup(run.pid!, run.pgid, 'SIGKILL');
        }, this.opts.graceSeconds * 1000).unref();
        this.markLost(run, 'Tué au redémarrage du service (politique kill)', 'killed');
        res.killed++;
      }
    }
    if (res.lost + res.killed + res.adopted) this.log.warn(res, 'Rapprochement des runs au démarrage');
    return res;
  }

  /** Suivi d'un processus survivant : on attend sa fin, sans pouvoir connaître son code de sortie. */
  private adopt(run: RunRow): void {
    this.appendLog(run, `[scriptnymous] service redémarré : processus ${run.pid} encore vivant, suivi jusqu'à sa fin (politique adopt)\n`);
    const t = setInterval(() => {
      if (isSameProcess(run.pid!, run.proc_start_ticks)) {
        this.repo.updateRun(run.id, { heartbeat_at: new Date().toISOString() });
        return;
      }
      clearInterval(t);
      this.adopted.delete(run.id);
      this.markLost(run, 'Terminé après un redémarrage du service : code de sortie inconnu');
    }, 5_000);
    this.adopted.set(run.id, t);
  }

  private markLost(run: RunRow, reason: string, status: RunRow['status'] = 'lost'): void {
    this.appendLog(run, `[scriptnymous] ${reason}\n`);
    const patch: Partial<RunRow> = { status, finished_at: new Date().toISOString(), error: reason };
    this.repo.updateRun(run.id, patch);
    const final = { ...run, ...patch } as RunRow;
    bus.emit('run:finished', { run: final });
  }

  private appendLog(run: RunRow, line: string): void {
    if (!run.log_path) return;
    try {
      fs.appendFileSync(run.log_path, line);
    } catch {
      /* journal purgé */
    }
  }

  start(intervalSeconds: number): void {
    this.timer = setInterval(() => this.sweep(), intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const t of this.adopted.values()) clearInterval(t);
  }

  /** Balayage : processus encore présents dans le groupe d'un run terminé → SIGKILL. */
  sweep(): { ghosts: number } {
    let ghosts = 0;
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    for (const run of this.repo.recentlyFinishedWithPgid(since)) {
      if (!run.pgid) continue;
      const pids = pidsInGroup(run.pgid).filter((p) => p !== process.pid);
      if (!pids.length) continue;
      ghosts += pids.length;
      this.log.warn({ run: run.id, pids }, 'Processus fantômes détectés : SIGKILL');
      killGroup(pids[0], run.pgid, 'SIGKILL');
      this.appendLog(run, `[scriptnymous] fantômes tués : ${pids.join(', ')}\n`);
    }
    // Runs « en cours » sans processus (ne devrait pas arriver hors redémarrage) : marqués perdus.
    for (const run of this.repo.runningRuns()) {
      if (this.runner.isLive(run.id) || this.adopted.has(run.id)) continue;
      if (run.pid && isSameProcess(run.pid, run.proc_start_ticks)) continue;
      this.markLost(run, 'Processus introuvable lors du balayage');
    }
    return { ghosts };
  }
}
