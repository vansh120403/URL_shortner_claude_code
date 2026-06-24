import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit + API (supertest) tests run under vitest. E2E (Playwright) is separate.
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    environment: 'node',
  },
});
