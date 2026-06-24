import path from 'node:path';
import { z } from 'zod';

/**
 * Environment configuration. Each field falls back to a safe default on any
 * invalid/missing value (`.catch`) rather than throwing — the app must never
 * crash at startup because of unrelated ambient environment variables (e.g. a
 * machine-wide BASE_URL/PORT). App-specific values are still honored when valid.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().catch(3000),
  BASE_URL: z.string().url().catch('http://localhost:3000'),
  // Number of trusted proxies in front of the app. NEVER a blanket "true".
  TRUST_PROXY: z.coerce.number().int().min(0).catch(0),
  DATABASE_PATH: z.string().min(1).catch('./data/urls.db'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().catch(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().catch(20),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().catch(300),
  SCREENING_PROVIDER: z.enum(['local', 'safebrowsing']).catch('local'),
  SCREENING_FAIL_OPEN: z
    .enum(['true', 'false'])
    .catch('true')
    .transform((v) => v === 'true'),
  SAFE_BROWSING_API_KEY: z.string().catch(''),
});

const env = EnvSchema.parse(process.env);

// Surface a security-relevant misconfiguration instead of silently defaulting:
// an unrecognized screening provider would otherwise quietly disable screening.
if (
  process.env.SCREENING_PROVIDER &&
  process.env.SCREENING_PROVIDER !== 'local' &&
  process.env.SCREENING_PROVIDER !== 'safebrowsing'
) {
  console.warn(
    `[config] SCREENING_PROVIDER="${process.env.SCREENING_PROVIDER}" is not recognized; falling back to "local".`,
  );
}

export const config = {
  port: env.PORT,
  baseUrl: env.BASE_URL.replace(/\/+$/, ''),
  trustProxy: env.TRUST_PROXY,
  databasePath:
    env.DATABASE_PATH === ':memory:'
      ? ':memory:'
      : path.resolve(process.cwd(), env.DATABASE_PATH),
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    globalMax: env.GLOBAL_RATE_LIMIT_MAX,
  },
  screening: {
    provider: env.SCREENING_PROVIDER,
    failOpen: env.SCREENING_FAIL_OPEN,
    safeBrowsingApiKey: env.SAFE_BROWSING_API_KEY,
  },
} as const;

export type ScreeningConfig = typeof config.screening;
