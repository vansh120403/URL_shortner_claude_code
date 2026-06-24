import { describe, it, expect } from 'vitest';
import { validateUrl, validateAlias } from '../../src/guardrails/validateUrl';

describe('validateUrl', () => {
  it('accepts http and https URLs', () => {
    expect(validateUrl('http://example.com/').ok).toBe(true);
    expect(validateUrl('https://example.com/a/b?c=d#e').ok).toBe(true);
  });

  it('rejects dangerous and non-web schemes', () => {
    for (const u of [
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd',
      'ftp://example.com/x',
    ]) {
      expect(validateUrl(u).ok).toBe(false);
    }
  });

  it('rejects empty, blank, non-string, and malformed input', () => {
    expect(validateUrl('').ok).toBe(false);
    expect(validateUrl('   ').ok).toBe(false);
    expect(validateUrl(null).ok).toBe(false);
    expect(validateUrl(42).ok).toBe(false);
    expect(validateUrl('not a url').ok).toBe(false);
  });

  it('rejects URLs longer than the limit', () => {
    const long = 'https://example.com/' + 'a'.repeat(2100);
    expect(validateUrl(long).ok).toBe(false);
  });

  it('normalizes scheme and host casing', () => {
    const r = validateUrl('HTTPS://Example.COM/Path');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.normalized).toBe('https://example.com/Path');
  });
});

describe('validateAlias', () => {
  it('accepts well-formed aliases', () => {
    expect(validateAlias('my-link_1').ok).toBe(true);
  });

  it('rejects bad shapes', () => {
    expect(validateAlias('ab').ok).toBe(false); // too short
    expect(validateAlias('a'.repeat(33)).ok).toBe(false); // too long
    expect(validateAlias('has space').ok).toBe(false);
    expect(validateAlias('emoji😀x').ok).toBe(false);
  });

  it('rejects reserved words', () => {
    expect(validateAlias('api').ok).toBe(false);
    expect(validateAlias('HealthZ').ok).toBe(false);
  });
});
