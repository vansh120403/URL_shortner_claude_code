import { test, expect } from '@playwright/test';

const PUBLIC_TARGET = 'https://93.184.216.34/'; // public IP literal → passes SSRF, needs no DNS

test('creates a short link, lists it, and redirects', async ({ page, request }) => {
  await page.goto('/');

  await page.fill('#url', PUBLIC_TARGET);
  await page.click('#submit');

  const link = page.locator('#result-link');
  await expect(link).toBeVisible();
  const shortUrl = (await link.textContent()) ?? '';
  expect(shortUrl).toMatch(/^http:\/\/localhost:3100\/[A-Za-z0-9_-]{3,32}$/);

  // It appears in the recent-links history.
  await expect(page.locator('.history-item').first()).toBeVisible();

  // Following the short link 302-redirects to the stored target.
  const res = await request.get(shortUrl, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()['location']).toBe(PUBLIC_TARGET);
});

test('rejects dangerous and private URLs in the UI', async ({ page }) => {
  await page.goto('/');
  for (const bad of ['javascript:alert(1)', 'http://localhost', 'http://169.254.169.254', 'http://0.0.0.0']) {
    await page.fill('#url', bad);
    await page.click('#submit');
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#result')).toBeHidden();
  }
});
