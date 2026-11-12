// Accès aux tables : fonctions typées, paramètres positionnels, aucune logique métier ici.
import type { DB } from './database.js';
import type { ScriptSpec } from '../core/spec.js';

export type ScriptStatus = 'ok' | 'invalid' | 'missing';
export type EnvStatus = 'none' | 'pending' | 'installing' | 'ready' | 'error';
export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'killed' | 'timeout' | 'lost' | 'skipped';
export type Trigger = 'manual' | 'schedule' | 'api' | 'retry' | 'queue' | 'catch_up';

export interface ScriptRow {
  slug: string;
  name: string;
  group: string | null;
  spec_json: string;
  spec_error: string | null;
  status: ScriptStatus;
  env_status: EnvStatus;
  env_fingerprint: string | null;
  env_log: string | null;
  env_updated_at: string | null;
  yaml_mtime: number | null;
  first_seen_at: string;
  last_seen_at: string;
  missing_since: string | null;
}

export interface ScriptRecord extends Omit<ScriptRow, 'spec_json'> {
  spec: ScriptSpec;
}

export interface RunRow {
  id: string;
  script_slug: string;
  script_name: string;
  trigger: Trigger;
  schedule_id: string | null;
  params_json: string;
  status: RunStatus;
  exit_code: number | null;
  signal: string | null;
  pid: number | null;
  pgid: number | null;
  proc_start_ticks: string | null;
  attempt: number;
  max_attempts: number;
  parent_run_id: string | null;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  log_path: string | null;
  log_bytes: number;
  error: string | null;
  created_at: string;
}

export interface QueueRow {
  id: string;
  script_slug: string;
  trigger: Trigger;
  schedule_id: string | null;
  params_json: string;
  attempt: number;
  parent_run_id: string | null;
  not_before: string | null;
  created_at: string;
}

export interface ScheduleStateRow {
  script_slug: string;
  schedule_id: string;
  last_fired_at: string | null;
  next_at: string | null;
}

const now = () => new Date().toISOString();

function toRecord(row: ScriptRow): ScriptRecord {
  const { spec_json, ...rest } = row;
  return { ...rest, spec: JSON.parse(spec_json) as ScriptSpec };
}

export class Repo {
  constructor(public readonly db: DB) {}

  // ---------- settings ----------
  getSetting(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now());
  }
  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  // ---------- scripts ----------
  listScripts(): ScriptRecord[] {
    return (this.db.prepare('SELECT * FROM scripts ORDER BY "group", name').all() as unknown as ScriptRow[]).map(toRecord);
  }
  getScript(slug: string): ScriptRecord | null {
    const r = this.db.prepare('SELECT * FROM scripts WHERE slug = ?').get(slug) as ScriptRow | undefined;
    return r ? toRecord(r) : null;
  }
  upsertScript(slug: string, spec: ScriptSpec, yamlMtime: number | null, specError: string | null): void {
    const t = now();
    this.db
      .prepare(
        `INSERT INTO scripts (slug, name, "group", spec_json, spec_error, status, yaml_mtime, first_seen_at, last_seen_at, missing_since)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name, "group" = excluded."group", spec_json = excluded.spec_json,
           spec_error = excluded.spec_error, status = excluded.status, yaml_mtime = excluded.yaml_mtime,
           last_seen_at = excluded.last_seen_at, missing_since = NULL`,
      )
      .run(slug, spec.name, spec.group ?? null, JSON.stringify(spec), specError, specError ? 'invalid' : 'ok', yamlMtime, t, t);
  }
  /** Marque un script absent du dossier (rien n'est supprimé). Renvoie true si l'état a changé. */
  markScriptMissing(slug: string): boolean {
    const r = this.db
      .prepare(`UPDATE scripts SET status = 'missing', missing_since = ? WHERE slug = ? AND status <> 'missing'`)
      .run(now(), slug);
    return r.changes > 0;
  }
  touchScriptSeen(slug: string): void {
    this.db.prepare('UPDATE scripts SET last_seen_at = ? WHERE slug = ?').run(now(), slug);
  }
  deleteScript(slug: string): void {
    this.db.prepare('DELETE FROM scripts WHERE slug = ?').run(slug);
    this.db.prepare('DELETE FROM schedule_state WHERE script_slug = ?').run(slug);
    this.db.prepare('DELETE FROM queue WHERE script_slug = ?').run(slug);
  }
  setEnvStatus(slug: string, status: EnvStatus, log: string | null, fingerprint: string | null): void {
    this.db
      .prepare('UPDATE scripts SET env_status = ?, env_log = ?, env_fingerprint = ?, env_updated_at = ? WHERE slug = ?')
      .run(status, log, fingerprint, now(), slug);
  }
  appendEnvLog(slug: string, chunk: string): void {
    this.db.prepare(`UPDATE scripts SET env_log = COALESCE(env_log, '') || ? WHERE slug = ?`).run(chunk, slug);
  }

  // ---------- runs ----------
  insertRun(run: RunRow): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, script_slug, script_name, trigger, schedule_id, params_json, status, exit_code, signal, pid, pgid,
          proc_start_ticks, attempt, max_attempts, parent_run_id, queued_at, started_at, finished_at, heartbeat_at, log_path, log_bytes, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id, run.script_slug, run.script_name, run.trigger, run.schedule_id, run.params_json, run.status, run.exit_code,
        run.signal, run.pid, run.pgid, run.proc_start_ticks, run.attempt, run.max_attempts, run.parent_run_id, run.queued_at,
        run.started_at, run.finished_at, run.heartbeat_at, run.log_path, run.log_bytes, run.error, run.created_at,
      );
  }
  updateRun(id: string, patch: Partial<RunRow>): void {
    const keys = Object.keys(patch).filter((k) => k !== 'id');
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const vals = keys.map((k) => (patch as Record<string, unknown>)[k] as never);
    this.db.prepare(`UPDATE runs SET ${sets} WHERE id = ?`).run(...vals, id);
  }
  getRun(id: string): RunRow | null {
    return (this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined) ?? null;
  }
  listRuns(opts: { slug?: string; status?: string; limit?: number; offset?: number; trigger?: string } = {}): RunRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.slug) {
      where.push('script_slug = ?');
      args.push(opts.slug);
    }
    if (opts.status) {
      where.push('status = ?');
      args.push(opts.status);
    }
    if (opts.trigger) {
      where.push('trigger = ?');
      args.push(opts.trigger);
    }
    const sql = `SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    args.push(opts.limit ?? 50, opts.offset ?? 0);
    return this.db.prepare(sql).all(...(args as never[])) as unknown as RunRow[];
  }
  countRuns(opts: { slug?: string; status?: string; trigger?: string } = {}): number {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.slug) {
      where.push('script_slug = ?');
      args.push(opts.slug);
    }
    if (opts.status) {
      where.push('status = ?');
      args.push(opts.status);
    }
    if (opts.trigger) {
      where.push('trigger = ?');
      args.push(opts.trigger);
    }
    const r = this.db
      .prepare(`SELECT COUNT(*) c FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`)
      .get(...(args as never[])) as { c: number };
    return r.c;
  }
  runningRuns(slug?: string): RunRow[] {
    if (slug) return this.db.prepare(`SELECT * FROM runs WHERE status = 'running' AND script_slug = ?`).all(slug) as unknown as RunRow[];
    return this.db.prepare(`SELECT * FROM runs WHERE status = 'running'`).all() as unknown as RunRow[];
  }
  lastRun(slug: string): RunRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM runs WHERE script_slug = ? AND status NOT IN ('queued') ORDER BY created_at DESC LIMIT 1`)
        .get(slug) as RunRow | undefined) ?? null
    );
  }
  /** Runs terminés dont le groupe de processus pourrait encore contenir des fantômes. */
  recentlyFinishedWithPgid(sinceIso: string): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE status NOT IN ('running','queued') AND pgid IS NOT NULL AND finished_at >= ? ORDER BY finished_at DESC`,
      )
      .all(sinceIso) as unknown as RunRow[];
  }
  oldRuns(beforeIso: string): RunRow[] {
    return this.db
      .prepare(`SELECT * FROM runs WHERE status NOT IN ('running','queued') AND created_at < ? ORDER BY created_at ASC`)
      .all(beforeIso) as unknown as RunRow[];
  }
  finishedRunsOldestFirst(): RunRow[] {
    return this.db.prepare(`SELECT * FROM runs WHERE status NOT IN ('running','queued') ORDER BY created_at ASC`).all() as unknown as RunRow[];
  }
  deleteRun(id: string): void {
    this.db.prepare('DELETE FROM runs WHERE id = ?').run(id);
  }
  runStats(): { total: number; running: number; failed24h: number; success24h: number } {
    const since = new Date(Date.now() - 86400_000).toISOString();
    const g = (sql: string, ...a: unknown[]) => (this.db.prepare(sql).get(...(a as never[])) as { c: number }).c;
    return {
      total: g('SELECT COUNT(*) c FROM runs'),
      running: g(`SELECT COUNT(*) c FROM runs WHERE status = 'running'`),
      failed24h: g(`SELECT COUNT(*) c FROM runs WHERE status IN ('failed','timeout','lost','killed') AND created_at >= ?`, since),
      success24h: g(`SELECT COUNT(*) c FROM runs WHERE status = 'success' AND created_at >= ?`, since),
    };
  }

  // ---------- queue ----------
  enqueue(item: QueueRow): void {
    this.db
      .prepare(
        `INSERT INTO queue (id, script_slug, trigger, schedule_id, params_json, attempt, parent_run_id, not_before, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(item.id, item.script_slug, item.trigger, item.schedule_id, item.params_json, item.attempt, item.parent_run_id, item.not_before, item.created_at);
  }
  dequeue(id: string): void {
    this.db.prepare('DELETE FROM queue WHERE id = ?').run(id);
  }
  listQueue(slug?: string): QueueRow[] {
    if (slug) return this.db.prepare('SELECT * FROM queue WHERE script_slug = ? ORDER BY created_at').all(slug) as unknown as QueueRow[];
    return this.db.prepare('SELECT * FROM queue ORDER BY created_at').all() as unknown as QueueRow[];
  }
  /** Prochain élément éligible pour un script (not_before dépassé), le plus ancien d'abord. */
  nextQueued(slug: string, nowIso: string): QueueRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM queue WHERE script_slug = ? AND (not_before IS NULL OR not_before <= ?) ORDER BY created_at LIMIT 1`)
        .get(slug, nowIso) as QueueRow | undefined) ?? null
    );
  }
  queuedSlugs(): string[] {
    return (this.db.prepare('SELECT DISTINCT script_slug FROM queue').all() as { script_slug: string }[]).map((r) => r.script_slug);
  }
  clearQueue(slug: string): number {
    return this.db.prepare('DELETE FROM queue WHERE script_slug = ?').run(slug).changes as number;
  }
  /** Supprime les relances (trigger « retry ») en attente d'un script : un passage réussi les rend sans objet. */
  clearRetries(slug: string): number {
    return this.db.prepare(`DELETE FROM queue WHERE script_slug = ? AND trigger = 'retry'`).run(slug).changes as number;
  }

  // ---------- schedule_state ----------
  getScheduleState(slug: string, scheduleId: string): ScheduleStateRow | null {
    return (
      (this.db.prepare('SELECT * FROM schedule_state WHERE script_slug = ? AND schedule_id = ?').get(slug, scheduleId) as
        | ScheduleStateRow
        | undefined) ?? null
    );
  }
  setScheduleState(slug: string, scheduleId: string, lastFiredAt: string | null, nextAt: string | null): void {
    this.db
      .prepare(
        `INSERT INTO schedule_state (script_slug, schedule_id, last_fired_at, next_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(script_slug, schedule_id) DO UPDATE SET
           last_fired_at = COALESCE(excluded.last_fired_at, schedule_state.last_fired_at), next_at = excluded.next_at`,
      )
      .run(slug, scheduleId, lastFiredAt, nextAt);
  }
  listScheduleStates(): ScheduleStateRow[] {
    return this.db.prepare('SELECT * FROM schedule_state').all() as unknown as ScheduleStateRow[];
  }

  // ---------- sessions ----------
  createSession(id: string, expiresAt: string, userAgent: string | null): void {
    this.db.prepare('INSERT INTO sessions (id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)').run(id, now(), expiresAt, userAgent);
  }
  getSession(id: string): { id: string; expires_at: string } | null {
    const r = this.db.prepare('SELECT id, expires_at FROM sessions WHERE id = ?').get(id) as { id: string; expires_at: string } | undefined;
    if (!r) return null;
    if (r.expires_at < now()) {
      this.deleteSession(id);
      return null;
    }
    return r;
  }
  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }
  purgeSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  }

  // ---------- notifications ----------
  logNotification(slug: string | null, runId: string | null, event: string, topic: string | null, ok: boolean, error: string | null): void {
    this.db
      .prepare('INSERT INTO notifications (script_slug, run_id, event, topic, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(slug, runId, event, topic, ok ? 1 : 0, error, now());
    this.db.prepare('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 500)').run();
  }
  listNotifications(limit = 50): unknown[] {
    return this.db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit);
  }
}
