// Lanceur : démarre le processus d'un run, capture la sortie vers un fichier journal et le bus, gère le délai maximum.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from '../config.js';
import type { Repo, RunRow } from '../db/repo.js';
import type { ScriptRecord } from '../db/repo.js';
import { bus } from './events.js';
import { buildInvocation, type ParamValues } from './params.js';
import { isWindows, killGroup, readProcStartTicks } from './proc.js';
import { ensureDir } from '../util/fs.js';
import { envRuntime } from './envs.js';

export interface LiveRun {
  run: RunRow;
  child: ChildProcess;
  stopRequested: boolean;
  timeoutTimer?: NodeJS.Timeout;
  graceTimer?: NodeJS.Timeout;
  heartbeat?: NodeJS.Timeout;
  logFd: number;
  logBytes: number;
}

function interpreterCommand(script: ScriptRecord): { cmd: string; args: string[] } {
  const spec = script.spec;
  if (spec.command) {
    // Commande libre : découpée sur les espaces (pas de shell), le fichier ajouté en argument.
    const parts = spec.command.split(/\s+/).filter(Boolean);
    return { cmd: parts[0], args: parts.slice(1) };
  }
  switch (spec.interpreter) {
    case 'python3':
      return { cmd: isWindows ? 'python' : 'python3', args: [] };
    case 'node':
      return { cmd: process.execPath, args: [] };
    case 'sh':
      return { cmd: 'sh', args: [] };
    default:
      return { cmd: 'bash', args: [] };
  }
}

export class Runner {
  readonly live = new Map<string, LiveRun>();

  constructor(private readonly repo: Repo) {}

  isLive(runId: string): boolean {
    return this.live.has(runId);
  }

  /** Démarre le processus du run (ligne `runs` déjà créée en statut queued/running). */
  start(script: ScriptRecord, run: RunRow, values: ParamValues): void {
    const spec = script.spec;
    const scriptDir = path.join(config.scriptsDir, script.slug);
    const file = path.resolve(scriptDir, spec.file);
    const cwd = spec.workdir ? path.resolve(scriptDir, spec.workdir) : scriptDir;
    const { cmd, args: preArgs } = interpreterCommand(script);
    const { args, env: paramEnv } = buildInvocation(spec, values);
    const runtime = envRuntime(script.slug, spec.deps);

    const logDir = path.join(paths.logs, script.slug);
    ensureDir(logDir);
    const logPath = path.join(logDir, `${run.id}.log`);
    const logFd = fs.openSync(logPath, 'a');

    const pathSep = isWindows ? ';' : ':';
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...spec.env,
      ...runtime.env,
      ...paramEnv,
      PATH: [...runtime.pathPrepend, process.env.PATH ?? ''].join(pathSep),
      SN_RUN_ID: run.id,
      SN_SCRIPT: script.slug,
      SN_TRIGGER: run.trigger,
      SN_ATTEMPT: String(run.attempt),
      SN_DATA_DIR: config.dataDir,
      SN_SCRIPTS_DIR: config.scriptsDir,
      PYTHONUNBUFFERED: '1',
      FORCE_COLOR: process.env.FORCE_COLOR ?? '0',
    };

    const startedAt = new Date().toISOString();
    const header = `[scriptnymous] ${startedAt} · ${spec.name} (${script.slug}) · essai ${run.attempt}/${run.max_attempts} · ${cmd} ${[...preArgs, spec.file, ...args].join(' ')}\n`;
    fs.writeSync(logFd, header);

    let child: ChildProcess;
    try {
      child = spawn(cmd, [...preArgs, file, ...args], {
        cwd,
        env,
        detached: !isWindows, // groupe de processus propre : on peut tuer tout l'arbre
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      this.failImmediately(run, logFd, logPath, header.length, `Impossible de lancer ${cmd} : ${(e as Error).message}`);
      return;
    }

    const live: LiveRun = { run, child, stopRequested: false, logFd, logBytes: header.length };
    this.live.set(run.id, live);

    const pid = child.pid ?? null;
    const startTicks = pid ? readProcStartTicks(pid) : null;
    const patch: Partial<RunRow> = {
      status: 'running',
      pid,
      pgid: pid && !isWindows ? pid : null,
      proc_start_ticks: startTicks,
      started_at: startedAt,
      heartbeat_at: startedAt,
      log_path: logPath,
    };
    this.repo.updateRun(run.id, patch);
    live.run = { ...run, ...patch } as RunRow;
    bus.emit('run:started', { run: live.run });
    bus.emit('run:output', { runId: run.id, slug: script.slug, chunk: header, stream: 'system' });

    const onData = (stream: 'stdout' | 'stderr') => (buf: Buffer) => {
      const chunk = buf.toString('utf8');
      try {
        fs.writeSync(logFd, buf);
        live.logBytes += buf.length;
      } catch {
        /* disque plein ou fichier purgé : on continue de diffuser */
      }
      bus.emit('run:output', { runId: run.id, slug: script.slug, chunk, stream });
    };
    child.stdout?.on('data', onData('stdout'));
    child.stderr?.on('data', onData('stderr'));

    child.on('error', (err) => {
      const msg = `[scriptnymous] erreur de lancement : ${err.message}\n`;
      try {
        fs.writeSync(logFd, msg);
      } catch {
        /* ignore */
      }
      bus.emit('run:output', { runId: run.id, slug: script.slug, chunk: msg, stream: 'system' });
      live.run.error = err.message;
      // `close` suit normalement ; si le spawn a échoué, `close` arrive aussi avec code null.
    });

    child.on('close', (code, signal) => {
      this.finish(live, code, signal);
    });

    if (spec.timeout_seconds > 0) {
      live.timeoutTimer = setTimeout(() => {
        this.terminate(live, 'timeout');
      }, spec.timeout_seconds * 1000);
    }
    live.heartbeat = setInterval(() => {
      this.repo.updateRun(run.id, { heartbeat_at: new Date().toISOString(), log_bytes: live.logBytes });
    }, 10_000);
  }

  private failImmediately(run: RunRow, logFd: number, logPath: string, bytes: number, message: string): void {
    const msg = `[scriptnymous] ${message}\n`;
    fs.writeSync(logFd, msg);
    fs.closeSync(logFd);
    const t = new Date().toISOString();
    const patch: Partial<RunRow> = {
      status: 'failed',
      started_at: t,
      finished_at: t,
      error: message,
      log_path: logPath,
      log_bytes: bytes + msg.length,
    };
    this.repo.updateRun(run.id, patch);
    bus.emit('run:output', { runId: run.id, slug: run.script_slug, chunk: msg, stream: 'system' });
    bus.emit('run:finished', { run: { ...run, ...patch } as RunRow });
  }

  /** Demande l'arrêt : SIGTERM puis SIGKILL après le délai de grâce. */
  stop(runId: string, reason: 'killed' | 'timeout' = 'killed'): boolean {
    const live = this.live.get(runId);
    if (!live) return false;
    this.terminate(live, reason);
    return true;
  }

  private terminate(live: LiveRun, reason: 'killed' | 'timeout'): void {
    if (live.stopRequested) return;
    live.stopRequested = true;
    live.run.status = reason;
    const msg =
      reason === 'timeout'
        ? `[scriptnymous] délai maximum dépassé : SIGTERM envoyé (SIGKILL dans ${config.killGraceSeconds}s)\n`
        : `[scriptnymous] arrêt demandé : SIGTERM envoyé (SIGKILL dans ${config.killGraceSeconds}s)\n`;
    try {
      fs.writeSync(live.logFd, msg);
    } catch {
      /* ignore */
    }
    bus.emit('run:output', { runId: live.run.id, slug: live.run.script_slug, chunk: msg, stream: 'system' });
    if (live.child.pid) killGroup(live.child.pid, live.run.pgid, 'SIGTERM');
    live.graceTimer = setTimeout(() => {
      if (live.child.pid && this.live.has(live.run.id)) killGroup(live.child.pid, live.run.pgid, 'SIGKILL');
    }, config.killGraceSeconds * 1000);
  }

  private finish(live: LiveRun, code: number | null, signal: NodeJS.Signals | null): void {
    if (live.timeoutTimer) clearTimeout(live.timeoutTimer);
    if (live.graceTimer) clearTimeout(live.graceTimer);
    if (live.heartbeat) clearInterval(live.heartbeat);
    this.live.delete(live.run.id);

    let status: RunRow['status'];
    if (live.stopRequested) status = live.run.status === 'timeout' ? 'timeout' : 'killed';
    else if (code === 0) status = 'success';
    else status = 'failed';

    // Dernier coup de balai sur le groupe : un enfant détaché pourrait survivre au parent.
    if (live.child.pid) killGroup(live.child.pid, live.run.pgid, 'SIGKILL');

    const finishedAt = new Date().toISOString();
    const footer = `[scriptnymous] ${finishedAt} · terminé : ${status}${code !== null ? ` (code ${code})` : ''}${signal ? ` (signal ${signal})` : ''}\n`;
    try {
      fs.writeSync(live.logFd, footer);
      live.logBytes += footer.length;
      fs.closeSync(live.logFd);
    } catch {
      /* ignore */
    }
    const patch: Partial<RunRow> = {
      status,
      exit_code: code,
      signal: signal ?? null,
      finished_at: finishedAt,
      log_bytes: live.logBytes,
      error: live.run.error ?? null,
    };
    this.repo.updateRun(live.run.id, patch);
    const final = { ...live.run, ...patch } as RunRow;
    bus.emit('run:output', { runId: final.id, slug: final.script_slug, chunk: footer, stream: 'system' });
    bus.emit('run:finished', { run: final });
  }

  /** Arrête tous les runs vivants (extinction du service) sans attendre. */
  stopAll(): void {
    for (const live of this.live.values()) this.terminate(live, 'killed');
  }
}
