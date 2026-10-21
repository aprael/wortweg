// SQLite-Zugriff über das in Node eingebaute node:sqlite (keine Abhängigkeiten) und ein kleiner Migrations-Runner.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
export const DEFAULT_DB_PATH = fileURLToPath(new URL('../data/wortweg.db', import.meta.url));

/** Öffnet die Datenbank (":memory:" für Tests) mit Fremdschlüsseln und WAL. */
export function openDb(path = DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/** Führt fn in einer Transaktion aus. Verschachtelte Aufrufe laufen in der äußeren Transaktion mit. */
export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => ({ version: Number(file.slice(0, 3)), name: file.slice(4, -4), file }));
}

/** Wendet alle noch fehlenden Migrationen an. Gibt die neu angewendeten Versionen zurück. */
export function migrate(db, now = Date.now()) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const applied = [];
  for (const m of listMigrations()) {
    if (done.has(m.version)) continue;
    const sql = readFileSync(MIGRATIONS_DIR + m.file, 'utf8');
    tx(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, now);
    });
    applied.push(m.version);
  }
  return applied;
}
