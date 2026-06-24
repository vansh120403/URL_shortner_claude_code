import fs from 'node:fs';
import path from 'node:path';

// node:sqlite is an experimental Node 22 builtin and is NOT listed in
// module.builtinModules, so bundlers (vitest/Vite) cannot resolve a bare
// `import ... from 'node:sqlite'` (they strip the prefix and look for a
// package named "sqlite"). process.getBuiltinModule() returns the builtin
// directly, bypassing module resolution — works under node, tsx, and vitest.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as unknown as typeof import('node:sqlite');

/** The database handle type, decoupled from the underlying driver. */
export type Db = InstanceType<typeof DatabaseSync>;

const MIGRATION = `
CREATE TABLE IF NOT EXISTS urls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT UNIQUE NOT NULL,
  target_url       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  click_count      INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT
);
`;

/**
 * Open (and migrate) a SQLite database using Node's built-in `node:sqlite`.
 * Pass ':memory:' for an ephemeral in-memory DB (used by tests). The parent
 * directory of a file-backed DB is created automatically.
 *
 * We use node:sqlite rather than a native driver because native addons cannot
 * be installed in this locked-down environment (no compiler; prebuilt-binary
 * CDN is blocked). node:sqlite is real SQLite, built into Node 22 — no install.
 */
export function createDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  // WAL gives durable, concurrent-reader-friendly writes; busy_timeout makes
  // concurrent writers wait rather than immediately throw SQLITE_BUSY.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(MIGRATION);
  return db;
}

let singleton: Db | null = null;

/** Process-wide singleton connection for the running server. */
export function getDb(dbPath: string): Db {
  if (!singleton) singleton = createDb(dbPath);
  return singleton;
}
