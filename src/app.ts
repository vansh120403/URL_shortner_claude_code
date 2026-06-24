import path from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import { config } from './config';
import type { Db } from './db';
import { createUrlService, AliasTakenError, type UrlRecord } from './services/urlService';
import { createScreener, type Screener } from './guardrails/screener';
import { validateUrl, validateAlias } from './guardrails/validateUrl';
import { checkSsrf } from './guardrails/ssrf';
import { AppError, errorHandler } from './middleware/errorHandler';
import { createLimiter } from './middleware/rateLimit';
import { CODE_PATTERN, RESERVED_CODES } from './constants';

export interface AppOptions {
  db: Db;
  /** Inject a screener (tests use a fake); defaults to the configured one. */
  screener?: Screener;
  baseUrl?: string;
  trustProxy?: number;
  rateLimit?: { windowMs?: number; shortenMax?: number; globalMax?: number };
}

/** Express 5 route params can be string | string[]; collapse to one string. */
function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function isReservedOrInvalidCode(code: string): boolean {
  return !CODE_PATTERN.test(code) || RESERVED_CODES.has(code.toLowerCase());
}

/**
 * Build the Express app. DB (and optionally screener / limits) are injected so
 * the same factory is used by the server and by tests (with an in-memory DB).
 */
export function createApp(options: AppOptions): Express {
  const { db } = options;
  const urlService = createUrlService(db);
  const screener = options.screener ?? createScreener();
  const baseUrl = (options.baseUrl ?? config.baseUrl).replace(/\/+$/, '');
  const trustProxy = options.trustProxy ?? config.trustProxy;
  const windowMs = options.rateLimit?.windowMs ?? config.rateLimit.windowMs;
  const shortenMax = options.rateLimit?.shortenMax ?? config.rateLimit.max;
  const globalMax = options.rateLimit?.globalMax ?? config.rateLimit.globalMax;

  const app = express();
  // Trust exactly N proxies — never a blanket `true`, which would let clients
  // spoof X-Forwarded-For and defeat per-IP rate limiting.
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(createLimiter(windowMs, globalMax));
  app.use(express.json({ limit: '16kb' }));

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  const toDto = (r: UrlRecord) => ({
    code: r.code,
    shortUrl: `${baseUrl}/${r.code}`,
    target: r.target_url,
    createdAt: r.created_at,
    clickCount: r.click_count,
    lastAccessedAt: r.last_accessed_at ?? null,
  });

  // ---- API ----
  const api = express.Router();
  const shortenLimiter = createLimiter(windowMs, shortenMax);

  api.post('/shorten', shortenLimiter, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { url?: unknown; alias?: unknown };

    // Guardrail #1 — URL format validation.
    const urlResult = validateUrl(body.url);
    if (!urlResult.ok) throw new AppError(400, 'INVALID_URL', urlResult.reason);

    // Optional custom alias.
    let alias: string | undefined;
    if (body.alias !== undefined && body.alias !== null && body.alias !== '') {
      if (typeof body.alias !== 'string') {
        throw new AppError(400, 'INVALID_ALIAS', 'Alias must be a string');
      }
      const aliasResult = validateAlias(body.alias);
      if (!aliasResult.ok) throw new AppError(400, 'INVALID_ALIAS', aliasResult.reason);
      alias = aliasResult.value;
    }

    // Guardrail #2 — SSRF / open-redirect protection.
    const ssrf = await checkSsrf(urlResult.value.url);
    if (!ssrf.ok) throw new AppError(400, 'PRIVATE_ADDRESS', ssrf.reason ?? 'Address not allowed');

    // Guardrail #4 — malicious-URL screening.
    const screen = await screener.screen(urlResult.value.normalized);
    if (!screen.safe) {
      throw new AppError(422, 'BLOCKED_URL', screen.reason ?? 'URL blocked by safety screening');
    }

    try {
      const record = urlService.create(urlResult.value.normalized, alias);
      res.status(201).json(toDto(record));
    } catch (e) {
      if (e instanceof AliasTakenError) {
        throw new AppError(409, 'ALIAS_TAKEN', 'That alias is already in use');
      }
      throw e;
    }
  });

  api.get('/urls', (_req: Request, res: Response) => {
    res.json({ urls: urlService.list().map(toDto) });
  });

  api.get('/urls/:code', (req: Request, res: Response) => {
    const record = urlService.getStats(firstParam(req.params.code));
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Short code not found');
    res.json(toDto(record));
  });

  app.use('/api', api);

  // ---- Static frontend (project-root /public, in both dev and built dist) ----
  app.use(express.static(path.resolve(__dirname, '../public')));

  // ---- Redirect: must come AFTER /api and static so it can't shadow them ----
  app.get('/:code', (req: Request, res: Response) => {
    const code = firstParam(req.params.code);
    if (isReservedOrInvalidCode(code)) {
      throw new AppError(404, 'NOT_FOUND', 'Not found');
    }
    const target = urlService.resolveAndCount(code);
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Short code not found');
    // 302 (not 301) so every click reaches the server for accurate counts.
    res.set('Cache-Control', 'no-store');
    res.redirect(302, target);
  });

  // Fallback 404 + unified error handler.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  app.use(errorHandler);

  return app;
}
