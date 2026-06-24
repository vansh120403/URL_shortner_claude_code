import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLocalScreener, createSafeBrowsingScreener } from '../../src/guardrails/screener';

describe('local screener (no network)', () => {
  it('allows a normal URL', async () => {
    expect((await createLocalScreener().screen('https://example.com/')).safe).toBe(true);
  });
  it('rejects a denylisted host', async () => {
    const s = createLocalScreener(new Set(['evil.example']));
    expect((await s.screen('https://evil.example/path')).safe).toBe(false);
  });
  it('rejects a malformed URL', async () => {
    expect((await createLocalScreener().screen('::::')).safe).toBe(false);
  });
});

describe('safe browsing screener', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('no key + fail-open → safe', async () => {
    expect((await createSafeBrowsingScreener('', true).screen('https://x/')).safe).toBe(true);
  });
  it('no key + fail-closed → unsafe', async () => {
    expect((await createSafeBrowsingScreener('', false).screen('https://x/')).safe).toBe(false);
  });
  it('a threat match → unsafe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ matches: [{ threatType: 'MALWARE' }] }), { status: 200 })),
    );
    expect((await createSafeBrowsingScreener('key', true).screen('https://bad/')).safe).toBe(false);
  });
  it('empty {} response → safe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    expect((await createSafeBrowsingScreener('key', true).screen('https://good/')).safe).toBe(true);
  });
  it('API error + fail-open → safe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })));
    expect((await createSafeBrowsingScreener('key', true).screen('https://x/')).safe).toBe(true);
  });
  it('network throw + fail-closed → unsafe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect((await createSafeBrowsingScreener('key', false).screen('https://x/')).safe).toBe(false);
  });
});
