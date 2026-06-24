import { z } from 'zod';
import { CODE_PATTERN, MAX_URL_LENGTH, RESERVED_CODES } from '../constants';

export interface ParsedTarget {
  /** Canonical, normalized form (scheme + host are lowercased by WHATWG URL). */
  normalized: string;
  /** The parsed URL, for downstream host/SSRF inspection. */
  url: URL;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const rawUrlSchema = z.string().trim().min(1).max(MAX_URL_LENGTH);

/**
 * Guardrail #1 — URL format validation. Accepts only well-formed http/https
 * URLs within a sane length, rejecting javascript:/data:/file:/etc. Parsing via
 * the WHATWG URL constructor also canonicalizes obfuscated IP encodings
 * (decimal/octal/hex), which the SSRF guardrail then classifies.
 */
export function validateUrl(raw: unknown): ValidationResult<ParsedTarget> {
  const parsed = rawUrlSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `URL must be a non-empty string up to ${MAX_URL_LENGTH} characters` };
  }

  let url: URL;
  try {
    url = new URL(parsed.data);
  } catch {
    return { ok: false, reason: 'URL is malformed' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: 'Only http and https URLs are allowed' };
  }
  if (!url.hostname) {
    return { ok: false, reason: 'URL must include a host' };
  }

  return { ok: true, value: { normalized: url.toString(), url } };
}

/** Validate a user-supplied custom alias (shape + reserved-word check). */
export function validateAlias(alias: string): ValidationResult<string> {
  if (!CODE_PATTERN.test(alias)) {
    return { ok: false, reason: 'Alias must be 3–32 characters: letters, digits, "_" or "-"' };
  }
  if (RESERVED_CODES.has(alias.toLowerCase())) {
    return { ok: false, reason: 'That alias is reserved' };
  }
  return { ok: true, value: alias };
}
