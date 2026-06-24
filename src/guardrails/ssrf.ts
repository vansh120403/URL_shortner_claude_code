import { lookup } from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

const DNS_TIMEOUT_MS = 3000;

/** Pluggable DNS resolver, so tests can inject deterministic results. */
export type LookupFn = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupFn = (hostname) => lookup(hostname, { all: true });

export interface SsrfCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Returns true if an IP address is NOT a globally-routable public unicast
 * address — i.e. loopback, private (RFC1918), link-local (incl. 169.254.169.254
 * cloud metadata), unique-local, carrier-grade NAT, reserved, multicast,
 * broadcast or unspecified (0.0.0.0 / ::). IPv4-mapped IPv6 (::ffff:127.0.0.1)
 * is unwrapped and classified as its embedded IPv4. Unparseable input is
 * treated as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true;
  }
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      addr = v6.toIPv4Address();
    }
  }
  // Only globally-routable unicast addresses are allowed.
  return addr.range() !== 'unicast';
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, '').replace(/\]$/, '');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Guardrail #2 — SSRF / open-redirect protection. The server never fetches the
 * target itself (it only stores it and later 302-redirects the visitor's
 * browser), so create-time classification is sufficient. We classify the
 * already-parsed hostname (never the raw string, defeating userinfo bypass like
 * `a@169.254.169.254`). For IP literals we classify directly; for hostnames we
 * resolve and reject if ANY resolved address is non-public. DNS failures are
 * treated as a rejection (fail-closed).
 */
export async function checkSsrf(
  url: URL,
  lookupFn: LookupFn = defaultLookup,
  timeoutMs: number = DNS_TIMEOUT_MS,
): Promise<SsrfCheck> {
  const host = stripBrackets(url.hostname);
  if (!host) return { ok: false, reason: 'URL is missing a host' };

  // Direct IP literal — WHATWG URL has already canonicalized decimal/octal/hex.
  if (net.isIP(host) !== 0) {
    return isBlockedIp(host)
      ? { ok: false, reason: 'URL points to a private, loopback, or reserved IP address' }
      : { ok: true };
  }

  // Hostname — resolve and reject if any resolved address is non-public.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await withTimeout(lookupFn(host), timeoutMs);
  } catch {
    return { ok: false, reason: 'Could not resolve the host' };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: 'Host did not resolve to any address' };
  }
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      return { ok: false, reason: 'Host resolves to a private, loopback, or reserved IP address' };
    }
  }
  return { ok: true };
}
