// Mini-app par script : base SQLite propre à chaque script (/data/apps/<slug>/app.db) dont les tables sont déclarées
// dans la section `app.tables` du YAML. Création et évolution (ajout de colonnes) automatiques, CRUD générique.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { AppSpec, AppTableSpec, AppColumnType } from './spec.js';
import { ensureDir } from '../util/fs.js';

export function appDir(slug: string): string {
  return path.join(config.dataDir, 'apps', slug);
}
export function appDbPath(slug: string): string {
  return path.join(appDir(slug), 'app.db');
}
export function appFilesDir(slug: string): string {
  return path.join(appDir(slug), 'files');
}

export class AppDbError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const SQL_TYPE: Record<AppColumnType, string> = { text: 'TEXT', integer: 'INTEGER', real: 'REAL', boolean: 'INTEGER', datetime: 'TEXT', json: 'TEXT' };
const SYSTEM_COLUMNS = ['_id', '_created_at', '_updated_at', '_run_id'];

export interface ColumnDef {
  name: string;
  type: AppColumnType;
  required: boolean;
}

export function parseColumns(t: AppTableSpec): ColumnDef[] {
  return Object.entries(t.columns).map(([name, def]) => ({ name, type: def.replace('!', '') as AppColumnType, required: def.endsWith('!') }));
}

export interface ListOptions {
  filters?: Record<string, string>;
  q?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export class AppDbManager {
  private readonly dbs = new Map<string, DatabaseSync>();

  private open(slug: string): DatabaseSync {
    let db = this.dbs.get(slug);
    if (db) return db;
    ensureDir(appDir(slug));
    ensureDir(appFilesDir(slug));
    db = new DatabaseSync(appDbPath(slug));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    this.dbs.set(slug, db);
    return db;
  }

  close(slug: string): void {
    this.dbs.get(slug)?.close();
    this.dbs.delete(slug);
  }
  closeAll(): void {
    for (const s of [...this.dbs.keys()]) this.close(s);
  }

  /** Crée les tables manquantes et ajoute les colonnes nouvelles (jamais de suppression). */
  ensure(slug: string, app: AppSpec | undefined): void {
    if (!app || !Object.keys(app.tables).length) return;
    const db = this.open(slug);
    for (const [name, t] of Object.entries(app.tables)) {
      const cols = parseColumns(t);
      const defs = cols.map((c) => `"${c.name}" ${SQL_TYPE[c.type]}`);
      db.exec(
        `CREATE TABLE IF NOT EXISTS "${name}" (_id INTEGER PRIMARY KEY AUTOINCREMENT, ${defs.join(', ')},
          _created_at TEXT NOT NULL, _updated_at TEXT NOT NULL, _run_id TEXT)`,
      );
      const existing = new Set((db.prepare(`PRAGMA table_info("${name}")`).all() as unknown as { name: string }[]).map((r) => r.name));
      for (const c of cols) if (!existing.has(c.name)) db.exec(`ALTER TABLE "${name}" ADD COLUMN "${c.name}" ${SQL_TYPE[c.type]}`);
      if (t.key) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "${name}_key" ON "${name}" ("${t.key}")`);
      db.exec(`CREATE INDEX IF NOT EXISTS "${name}_updated" ON "${name}" (_updated_at)`);
    }
  }

  private table(app: AppSpec | undefined, name: string): AppTableSpec {
    const t = app?.tables[name];
    if (!t) throw new AppDbError(`Table inconnue : ${name}`, 404);
    return t;
  }

  private encode(col: ColumnDef, v: unknown): unknown {
    if (v === undefined || v === null || v === '') return null;
    switch (col.type) {
      case 'integer':
        return Math.trunc(Number(v));
      case 'real':
        return Number(v);
      case 'boolean':
        return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
      case 'json':
        return typeof v === 'string' ? v : JSON.stringify(v);
      case 'datetime':
        return typeof v === 'number' ? new Date(v > 1e12 ? v : v * 1000).toISOString() : String(v);
      default:
        return String(v);
    }
  }

  /** SQLite écrit `datetime('now')` en UTC sans fuseau : on le rend explicite pour les clients. */
  private isoUtc(v: unknown): unknown {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(' ', 'T') + 'Z' : v;
  }

  private decode(cols: ColumnDef[], row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...row, _created_at: this.isoUtc(row._created_at), _updated_at: this.isoUtc(row._updated_at) };
    for (const c of cols) {
      const v = row[c.name];
      if (v === null || v === undefined) continue;
      if (c.type === 'boolean') out[c.name] = v === 1;
      else if (c.type === 'json') {
        try {
          out[c.name] = JSON.parse(String(v));
        } catch {
          /* valeur brute */
        }
      }
    }
    return out;
  }

  /** Insère ou met à jour (par clé déclarée) une liste de lignes. */
  upsert(slug: string, app: AppSpec | undefined, name: string, rows: Record<string, unknown>[], runId: string | null): { upserted: number; pruned: number } {
    const t = this.table(app, name);
    const cols = parseColumns(t);
    const db = this.open(slug);
    const now = new Date().toISOString();
    const names = cols.map((c) => `"${c.name}"`);
    const placeholders = cols.map(() => '?');
    const updates = cols.filter((c) => c.name !== t.key).map((c) => `"${c.name}" = COALESCE(excluded."${c.name}", "${name}"."${c.name}")`);
    const sql = t.key
      ? `INSERT INTO "${name}" (${names.join(', ')}, _created_at, _updated_at, _run_id) VALUES (${placeholders.join(', ')}, ?, ?, ?)
         ON CONFLICT("${t.key}") DO UPDATE SET ${updates.length ? updates.join(', ') + ',' : ''} _updated_at = excluded._updated_at, _run_id = excluded._run_id`
      : `INSERT INTO "${name}" (${names.join(', ')}, _created_at, _updated_at, _run_id) VALUES (${placeholders.join(', ')}, ?, ?, ?)`;
    const stmt = db.prepare(sql);
    db.exec('BEGIN');
    try {
      for (const row of rows) {
        for (const c of cols) if (c.required && (row[c.name] === undefined || row[c.name] === null || row[c.name] === '')) throw new AppDbError(`${name}.${c.name} est obligatoire`);
        const unknown = Object.keys(row).find((k) => !cols.some((c) => c.name === k) && !SYSTEM_COLUMNS.includes(k));
        if (unknown) throw new AppDbError(`${name} : colonne inconnue « ${unknown} »`);
        stmt.run(...(cols.map((c) => this.encode(c, row[c.name])) as never[]), now, now, runId);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { upserted: rows.length, pruned: this.prune(slug, name, t) };
  }

  private prune(slug: string, name: string, t: AppTableSpec): number {
    if (!t.max_rows) return 0;
    const db = this.open(slug);
    return db.prepare(`DELETE FROM "${name}" WHERE _id IN (SELECT _id FROM "${name}" ORDER BY _updated_at DESC LIMIT -1 OFFSET ?)`).run(t.max_rows).changes as number;
  }

  /** Mise à jour partielle d'une ligne par sa clé (ou `_id`). */
  patch(slug: string, app: AppSpec | undefined, name: string, key: string, patch: Record<string, unknown>): boolean {
    const t = this.table(app, name);
    const cols = parseColumns(t);
    const db = this.open(slug);
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const c = cols.find((x) => x.name === k);
      if (!c) throw new AppDbError(`${name} : colonne inconnue « ${k} »`);
      sets.push(`"${k}" = ?`);
      vals.push(this.encode(c, v));
    }
    if (!sets.length) return true;
    sets.push('_updated_at = ?');
    vals.push(new Date().toISOString());
    const r = db.prepare(`UPDATE "${name}" SET ${sets.join(', ')} WHERE ${this.keyWhere(t)} = ?`).run(...(vals as never[]), key);
    return r.changes > 0;
  }

  private keyWhere(t: AppTableSpec): string {
    return t.key ? `"${t.key}"` : '_id';
  }

  delete(slug: string, app: AppSpec | undefined, name: string, key: string): boolean {
    const t = this.table(app, name);
    return this.open(slug).prepare(`DELETE FROM "${name}" WHERE ${this.keyWhere(t)} = ?`).run(key).changes > 0;
  }

  /** Suppression par filtre (ex. toutes les lignes `status = pending`). Sans filtre : vide la table. */
  deleteWhere(slug: string, app: AppSpec | undefined, name: string, filters: Record<string, string>): number {
    const t = this.table(app, name);
    const cols = parseColumns(t);
    const where: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(filters)) {
      const c = cols.find((x) => x.name === k);
      if (!c) throw new AppDbError(`${name} : colonne inconnue « ${k} »`);
      where.push(`"${k}" = ?`);
      args.push(this.encode(c, v));
    }
    return this.open(slug).prepare(`DELETE FROM "${name}"${where.length ? ' WHERE ' + where.join(' AND ') : ''}`).run(...(args as never[])).changes as number;
  }

  list(slug: string, app: AppSpec | undefined, name: string, opts: ListOptions = {}): { rows: Record<string, unknown>[]; total: number } {
    const t = this.table(app, name);
    const cols = parseColumns(t);
    const db = this.open(slug);
    const where: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(opts.filters ?? {})) {
      const c = cols.find((x) => x.name === k);
      if (!c) throw new AppDbError(`${name} : colonne inconnue « ${k} »`);
      if (v === 'null') where.push(`"${k}" IS NULL`);
      else {
        where.push(`"${k}" = ?`);
        args.push(this.encode(c, v));
      }
    }
    if (opts.q) {
      const textCols = cols.filter((c) => c.type === 'text' || c.type === 'json');
      if (textCols.length) {
        where.push('(' + textCols.map((c) => `"${c.name}" LIKE ?`).join(' OR ') + ')');
        for (const _ of textCols) args.push(`%${opts.q}%`);
      }
    }
    const sortSpec = opts.sort ?? t.order ?? '-_updated_at';
    const desc = sortSpec.startsWith('-');
    const sortCol = sortSpec.replace(/^-/, '');
    if (!cols.some((c) => c.name === sortCol) && !SYSTEM_COLUMNS.includes(sortCol)) throw new AppDbError(`${name} : tri sur une colonne inconnue « ${sortCol} »`);
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (db.prepare(`SELECT COUNT(*) c FROM "${name}" ${w}`).get(...(args as never[])) as { c: number }).c;
    const rows = db
      .prepare(`SELECT * FROM "${name}" ${w} ORDER BY "${sortCol}" ${desc ? 'DESC' : 'ASC'} NULLS LAST, _id DESC LIMIT ? OFFSET ?`)
      .all(...(args as never[]), Math.min(1000, Math.max(1, opts.limit ?? 60)), Math.max(0, opts.offset ?? 0)) as unknown as Record<string, unknown>[];
    return { rows: rows.map((r) => this.decode(cols, r)), total };
  }

  get(slug: string, app: AppSpec | undefined, name: string, key: string): Record<string, unknown> | null {
    const t = this.table(app, name);
    const r = this.open(slug).prepare(`SELECT * FROM "${name}" WHERE ${this.keyWhere(t)} = ?`).get(key) as Record<string, unknown> | undefined;
    return r ? this.decode(parseColumns(t), r) : null;
  }

  /** Compte total, par statut et par groupe d'après la vue déclarée. */
  stats(slug: string, app: AppSpec | undefined, name: string): { total: number; by_status: Record<string, number>; groups: { group: string; count: number }[]; last_update: string | null } {
    const t = this.table(app, name);
    const db = this.open(slug);
    const total = (db.prepare(`SELECT COUNT(*) c FROM "${name}"`).get() as { c: number }).c;
    const last = this.isoUtc((db.prepare(`SELECT MAX(_updated_at) m FROM "${name}"`).get() as { m: string | null }).m) as string | null;
    let by_status: Record<string, number> = {};
    const st = t.view?.status;
    if (st?.startsWith('=')) by_status = { [st.slice(1)]: total };
    else if (st) {
      const rows = db.prepare(`SELECT COALESCE("${st}", 'ok') s, COUNT(*) c FROM "${name}" GROUP BY s`).all() as unknown as { s: string; c: number }[];
      by_status = Object.fromEntries(rows.map((r) => [String(r.s), r.c]));
    }
    let groups: { group: string; count: number }[] = [];
    const g = t.view?.group;
    if (g && !g.startsWith('=')) {
      const rows = db.prepare(`SELECT "${g}" g, COUNT(*) c FROM "${name}" WHERE "${g}" IS NOT NULL GROUP BY g ORDER BY c DESC, g LIMIT 100`).all() as unknown as { g: unknown; c: number }[];
      groups = rows.map((r) => ({ group: String(r.g), count: r.c }));
    }
    return { total, by_status, groups, last_update: last };
  }

  /** Résumé compact pour les cartes du tableau de bord : première table déclarée. */
  summary(slug: string, app: AppSpec | undefined): { table: string; total: number; by_status: Record<string, number> } | null {
    const first = app ? Object.keys(app.tables)[0] : undefined;
    if (!first || !fs.existsSync(appDbPath(slug))) return null;
    try {
      const s = this.stats(slug, app, first);
      return { table: first, total: s.total, by_status: s.by_status };
    } catch {
      return null;
    }
  }
}
