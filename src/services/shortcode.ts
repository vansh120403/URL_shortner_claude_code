import { randomBytes } from 'node:crypto';
import { SHORTCODE_LENGTH } from '../constants';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Largest multiple of 62 that fits in a byte (4 * 62 = 248). Bytes >= 248 are
// rejected to keep the mapping uniform (no modulo bias).
const REJECT_THRESHOLD = 248;

/**
 * Generate a cryptographically-random, URL-safe base62 short code. Uniqueness
 * is enforced by the database UNIQUE constraint (with retry), not here.
 */
export function generateCode(length: number = SHORTCODE_LENGTH): string {
  let out = '';
  while (out.length < length) {
    const bytes = randomBytes(length);
    for (const b of bytes) {
      if (out.length >= length) break;
      if (b < REJECT_THRESHOLD) {
        out += ALPHABET.charAt(b % 62);
      }
    }
  }
  return out;
}
