import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';

/**
 * Guardrail #3 — per-IP rate limiting. Returns the app's standard error shape
 * on a 429. Caller is responsible for setting `trust proxy` correctly so the
 * client IP can't be spoofed via X-Forwarded-For.
 */
export function createLimiter(windowMs: number, limit: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down.' },
      });
    },
  });
}
