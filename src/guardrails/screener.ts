import type { ScreeningConfig } from '../config';
import { config } from '../config';

const SCREEN_TIMEOUT_MS = 3000;

export interface ScreenResult {
  safe: boolean;
  reason?: string;
}

/** Guardrail #4 — pluggable malicious-URL screener. */
export interface Screener {
  screen(url: string): Promise<ScreenResult>;
}

/**
 * Hosts that should always be rejected, regardless of any external API. Matched
 * by EXACT lowercased hostname (no subdomain/suffix matching) — add each host
 * explicitly. Empty by default. Compared against `new URL(url).hostname`.
 */
const HOST_DENYLIST: ReadonlySet<string> = new Set<string>([]);

/**
 * Local, no-network screener. Always available — guarantees guardrail #4 still
 * functions even when every external API is blocked by a corporate proxy.
 */
export function createLocalScreener(
  denylist: ReadonlySet<string> = HOST_DENYLIST,
): Screener {
  return {
    async screen(url: string): Promise<ScreenResult> {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return { safe: false, reason: 'URL is malformed' };
      }
      // Exact-host match only (see HOST_DENYLIST note).
      if (denylist.has(host)) {
        return { safe: false, reason: 'Host is on the local denylist' };
      }
      return { safe: true };
    },
  };
}

// Warn once (not per-request) when Safe Browsing silently fails open, so an
// operator notices that URLs are going unscreened instead of it being invisible.
let warnedFailOpen = false;
function noteFailOpen(reason: string): void {
  if (warnedFailOpen) return;
  warnedFailOpen = true;
  console.warn(
    `[screener] Safe Browsing unavailable (${reason}); failing OPEN — URLs are NOT being screened. ` +
      `Set SCREENING_FAIL_OPEN=false to block instead.`,
  );
}

/**
 * Google Safe Browsing v4 lookup screener.
 *
 * NOTE: Safe Browsing v4 is deprecated (sunset 2027-03-31) and licensed for
 * NON-COMMERCIAL use only. Commercial use must migrate to the paid Web Risk API.
 * This provider is opt-in via SCREENING_PROVIDER=safebrowsing and never the
 * default. It fails open or closed per `failOpen`, times out quickly so a
 * blocked endpoint can't stall request handling, and warns once on fail-open.
 */
export function createSafeBrowsingScreener(apiKey: string, failOpen: boolean): Screener {
  return {
    async screen(url: string): Promise<ScreenResult> {
      if (!apiKey) {
        if (failOpen) {
          noteFailOpen('no API key configured');
          return { safe: true };
        }
        return { safe: false, reason: 'Safe Browsing screening is not configured' };
      }
      const requestBody = {
        client: { clientId: 'url-shortener', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: [
            'MALWARE',
            'SOCIAL_ENGINEERING',
            'UNWANTED_SOFTWARE',
            'POTENTIALLY_HARMFUL_APPLICATION',
          ],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SCREEN_TIMEOUT_MS);
      try {
        const res = await fetch(
          `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          },
        );
        if (!res.ok) {
          if (failOpen) {
            noteFailOpen(`API returned ${res.status}`);
            return { safe: true };
          }
          return { safe: false, reason: `Safe Browsing API returned ${res.status}` };
        }
        const data = (await res.json()) as { matches?: unknown[] };
        if (data.matches && data.matches.length > 0) {
          return { safe: false, reason: 'URL was flagged by Google Safe Browsing' };
        }
        return { safe: true };
      } catch {
        if (failOpen) {
          noteFailOpen('request failed or timed out');
          return { safe: true };
        }
        return { safe: false, reason: 'Safe Browsing request failed' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Build the active screener from config. The local denylist is always applied
 * first; Safe Browsing (if enabled) runs only for URLs that pass it.
 */
export function createScreener(screening: ScreeningConfig = config.screening): Screener {
  const local = createLocalScreener();
  if (screening.provider === 'safebrowsing') {
    const safeBrowsing = createSafeBrowsingScreener(
      screening.safeBrowsingApiKey,
      screening.failOpen,
    );
    return {
      async screen(url: string): Promise<ScreenResult> {
        const localResult = await local.screen(url);
        if (!localResult.safe) return localResult;
        return safeBrowsing.screen(url);
      },
    };
  }
  return local;
}
