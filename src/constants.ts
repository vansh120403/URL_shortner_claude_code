// Shared constants used across guardrails, services, and routing.

/** Maximum accepted length of a target URL. */
export const MAX_URL_LENGTH = 2048;

/** Number of characters in a generated short code. 62^7 ≈ 3.5e12 keyspace. */
export const SHORTCODE_LENGTH = 7;

/** Allowed shape for both generated codes and user-supplied aliases. */
export const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/**
 * Paths that must never be usable as a short code / alias, because they collide
 * with real routes or static assets. Compared case-insensitively.
 */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'api',
  'healthz',
  'health',
  'favicon.ico',
  'robots.txt',
  'assets',
  'static',
  'public',
  'index.html',
  'app.js',
  'styles.css',
]);
