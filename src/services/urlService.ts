import type { Db } from '../db';
import { SHORTCODE_LENGTH } from '../constants';
import { generateCode } from './shortcode';

export interface UrlRecord {
  code: string;
  target_url: string;
  created_at: string;
  click_count: number;
  last_accessed_at: string | null;
}

/** Thrown when a requested custom alias is already taken. */
export class AliasTakenError extends Error {
  constructor() {
    super('Alias already in use');
    this.name = 'AliasTakenError';
  }
}

const MAX_COLLISION_RETRIES = 5;

// SQLite extended result codes for the constraint violations we retry on.
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;

export interface UrlService {
  /** Create a short link. Throws AliasTakenError if `alias` is taken. */
  create(targetUrl: string, alias?: string): UrlRecord;
  /** Resolve a code to its target and atomically record one click. */
  resolveAndCount(code: string): string | null;
  /** Most-recent links first. */
  list(limit?: number): UrlRecord[];
  /** Stats for a single code, or null if unknown. */
  getStats(code: string): UrlRecord | null;
}

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { errcode?: number; message?: string };
  return (
    err.errcode === SQLITE_CONSTRAINT_UNIQUE ||
    err.errcode === SQLITE_CONSTRAINT_PRIMARYKEY ||
    (typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed'))
  );
}

export function createUrlService(db: Db): UrlService {
  const insertStmt = db.prepare(
    `INSERT INTO urls (code, target_url) VALUES (?, ?)
     RETURNING code, target_url, created_at, click_count, last_accessed_at`,
  );
  // Single atomic statement: increment + stamp + return target, with no
  // read-then-write race. node:sqlite serializes writes on one connection.
  const resolveStmt = db.prepare(
    `UPDATE urls
       SET click_count = click_count + 1, last_accessed_at = datetime('now')
     WHERE code = ?
     RETURNING target_url`,
  );
  const listStmt = db.prepare(
    `SELECT code, target_url, created_at, click_count, last_accessed_at
       FROM urls ORDER BY id DESC LIMIT ?`,
  );
  const statsStmt = db.prepare(
    `SELECT code, target_url, created_at, click_count, last_accessed_at
       FROM urls WHERE code = ?`,
  );

  return {
    create(targetUrl, alias) {
      if (alias) {
        try {
          return insertStmt.get(alias, targetUrl) as unknown as UrlRecord;
        } catch (e) {
          if (isUniqueViolation(e)) throw new AliasTakenError();
          throw e;
        }
      }
      // Generate-and-insert, relying on the UNIQUE constraint as source of
      // truth (no pre-check, which would be a TOCTOU race). Retry on collision.
      for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
        const code = generateCode(SHORTCODE_LENGTH);
        try {
          return insertStmt.get(code, targetUrl) as unknown as UrlRecord;
        } catch (e) {
          if (isUniqueViolation(e)) continue;
          throw e;
        }
      }
      throw new Error('Failed to generate a unique short code after several attempts');
    },

    resolveAndCount(code) {
      const row = resolveStmt.get(code) as { target_url: string } | undefined;
      return row ? row.target_url : null;
    },

    list(limit = 100) {
      return listStmt.all(limit) as unknown as UrlRecord[];
    },

    getStats(code) {
      return (statsStmt.get(code) as unknown as UrlRecord | undefined) ?? null;
    },
  };
}
