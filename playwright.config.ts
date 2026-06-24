import { defineConfig } from '@playwright/test';

// E2E drives the real server. We use the system-installed Microsoft Edge
// (channel: 'msedge') to avoid downloading a browser binary — that CDN is
// blocked in this environment. The server runs on an isolated port with an
// in-memory DB so e2e never touches real data.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3100',
    channel: 'msedge',
    headless: true,
  },
  webServer: {
    command: 'npx tsx src/server.ts',
    url: 'http://localhost:3100/healthz',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: '3100',
      BASE_URL: 'http://localhost:3100',
      DATABASE_PATH: ':memory:',
      SCREENING_PROVIDER: 'local',
    },
  },
});
