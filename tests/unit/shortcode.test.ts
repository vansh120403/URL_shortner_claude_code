import { describe, it, expect } from 'vitest';
import { generateCode } from '../../src/services/shortcode';

describe('generateCode', () => {
  it('produces a 7-char URL-safe base62 code by default', () => {
    const code = generateCode();
    expect(code).toMatch(/^[0-9A-Za-z]{7}$/);
  });

  it('respects a custom length', () => {
    expect(generateCode(12)).toHaveLength(12);
    expect(generateCode(3)).toHaveLength(3);
  });

  it('is overwhelmingly unique across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateCode());
    // Collisions in 5000 draws over a 62^7 space should be effectively zero.
    expect(seen.size).toBe(5000);
  });
});
