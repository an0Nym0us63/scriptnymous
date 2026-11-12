// Ouverture de la base SQLite (module intégré node:sqlite, Node ≥ 22.13) et application des migrations
// (fichiers SQL numérotés dans server/migrations). Décision documentée dans docs/decisions.md.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir } from '../util/fs.js';

export type DB = DatabaseSync;

const here = path.dirname(fileURLToPath(import.meta.url));

function migrationsDir(): string {
  // src/db -> ../../migrations (identique une fois compilé dans dist/db).
  return path.resolve(here, '..', '..', 'migrations');
}

export function openDatabase(file: string): DB {
  ensureDir(path.dirname(file));
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

export function openMemoryDatabase(): DB {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** Exécute `fn` dans une transaction ; annule en cas d'exception. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* déjà annulée */
    }
    throw e;
  }
}

function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const dir = migrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const insert = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      insert.run(f, new Date().toISOString());
    });
  }
}
