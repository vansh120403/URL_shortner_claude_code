import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp, type AppOptions } from '../../src/app';
import { createDb } from '../../src/db';
import type { Screener } from '../../src/guardrails/screener';

const allowAll: Screener = { async screen() { return { safe: true }; } };

function makeApp(overrides: Partial<AppOptions> = {}) {
  return createApp({
    db: createDb(':memory:'),
    screener: allowAll,
    baseUrl: 'http://short.test',
    trustProxy: 0,
    rateLimit: { windowMs: 60_000, shortenMax: 1000, globalMax: 1_000_000 },
    ...overrides,
  });
}

const PUBLIC_URL = 'https://93.184.216.34/'; // public IP literal → no DNS, passes SSRF

describe('POST /api/shorten', () => {
  it('creates a short link', async () => {
    const res = await request(makeApp()).post('/api/shorten').send({ url: PUBLIC_URL });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Za-z0-9_-]{3,32}$/);
    expect(res.body.shortUrl).toBe(`http://short.test/${res.body.code}`);
    expect(res.body.target).toBe(PUBLIC_URL);
    expect(res.body.clickCount).toBe(0);
  });

  it('honors a custom alias and rejects duplicates with 409', async () => {
    const app = makeApp();
    const first = await request(app).post('/api/shorten').send({ url: PUBLIC_URL, alias: 'my-alias' });
    expect(first.status).toBe(201);
    expect(first.body.code).toBe('my-alias');

    const dup = await request(app).post('/api/shorten').send({ url: PUBLIC_URL, alias: 'my-alias' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALIAS_TAKEN');
  });

  it('rejects invalid and dangerous URLs (400 INVALID_URL)', async () => {
    const app = makeApp();
    for (const url of ['not a url', 'javascript:alert(1)', 'ftp://example.com/x']) {
      const res = await request(app).post('/api/shorten').send({ url });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_URL');
    }
  });

  it('rejects private / link-local IPs (400 PRIVATE_ADDRESS)', async () => {
    const app = makeApp();
    for (const url of ['http://10.0.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://0.0.0.0/']) {
      const res = await request(app).post('/api/shorten').send({ url });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PRIVATE_ADDRESS');
    }
  });

  it('rejects a bad alias shape (400 INVALID_ALIAS)', async () => {
    const res = await request(makeApp()).post('/api/shorten').send({ url: PUBLIC_URL, alias: 'no spaces!' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ALIAS');
  });

  it('blocks URLs flagged by the screener (422 BLOCKED_URL)', async () => {
    const blockAll: Screener = { async screen() { return { safe: false, reason: 'nope' }; } };
    const res = await request(makeApp({ screener: blockAll })).post('/api/shorten').send({ url: PUBLIC_URL });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BLOCKED_URL');
  });

  it('returns 413 for an oversized body', async () => {
    const huge = 'https://example.com/' + 'a'.repeat(20_000);
    const res = await request(makeApp()).post('/api/shorten').set('Content-Type', 'application/json').send(JSON.stringify({ url: huge }));
    expect(res.status).toBe(413);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(makeApp())
      .post('/api/shorten')
      .set('Content-Type', 'application/json')
      .send('{ this is not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('GET /:code (redirect + click counting)', () => {
  it('302-redirects to the target and counts the click', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/shorten').send({ url: PUBLIC_URL });
    const code = created.body.code;

    const redirect = await request(app).get(`/${code}`).redirects(0);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(PUBLIC_URL);
    expect(redirect.headers['cache-control']).toContain('no-store');

    const stats = await request(app).get(`/api/urls/${code}`);
    expect(stats.body.clickCount).toBe(1);
  });

  it('404s for an unknown code', async () => {
    const res = await request(makeApp()).get('/doesnotexist').redirects(0);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404s for a reserved path used as a code', async () => {
    const res = await request(makeApp()).get('/assets').redirects(0);
    expect(res.status).toBe(404);
  });
});

describe('infrastructure', () => {
  it('GET /healthz → 200', async () => {
    const res = await request(makeApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('enforces the per-IP rate limit (429)', async () => {
    const app = makeApp({ rateLimit: { windowMs: 60_000, shortenMax: 2, globalMax: 1_000_000 } });
    await request(app).post('/api/shorten').send({ url: PUBLIC_URL });
    await request(app).post('/api/shorten').send({ url: PUBLIC_URL });
    const third = await request(app).post('/api/shorten').send({ url: PUBLIC_URL });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('lists created links most-recent-first', async () => {
    const app = makeApp();
    await request(app).post('/api/shorten').send({ url: 'https://1.1.1.1/' });
    await request(app).post('/api/shorten').send({ url: 'https://8.8.8.8/' });
    const res = await request(app).get('/api/urls');
    expect(res.body.urls).toHaveLength(2);
    expect(res.body.urls[0].target).toBe('https://8.8.8.8/');
  });
});
