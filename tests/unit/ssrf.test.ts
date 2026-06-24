import { describe, it, expect } from 'vitest';
import { isBlockedIp, checkSsrf, type LookupFn } from '../../src/guardrails/ssrf';

const BLOCKED = [
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '10.0.0.1',
  '192.168.1.1',
  '172.16.0.1',
  '169.254.169.254', // cloud metadata
  'fe80::1',
  'fc00::1',
  '::ffff:127.0.0.1', // IPv4-mapped loopback
  '::ffff:169.254.169.254', // IPv4-mapped metadata
  '255.255.255.255',
  '224.0.0.1', // multicast
  '100.64.0.1', // carrier-grade NAT
];

const ALLOWED = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'];

describe('isBlockedIp', () => {
  for (const ip of BLOCKED) {
    it(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }
  for (const ip of ALLOWED) {
    it(`allows ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }
  it('blocks unparseable input', () => expect(isBlockedIp('not-an-ip')).toBe(true));
});

const lookupReturning =
  (...addrs: string[]): LookupFn =>
  async () =>
    addrs.map((address) => ({ address }));
const lookupThrows: LookupFn = async () => {
  throw new Error('nxdomain');
};

async function ok(url: string, lookup: LookupFn): Promise<boolean> {
  return (await checkSsrf(new URL(url), lookup)).ok;
}

describe('checkSsrf — IP literals (no DNS)', () => {
  it('allows a public IP', async () => expect(await ok('https://93.184.216.34/', lookupThrows)).toBe(true));
  it('blocks a private IP', async () => expect(await ok('http://10.0.0.1/', lookupThrows)).toBe(false));
  it('blocks IPv6 loopback literal', async () => expect(await ok('http://[::1]/', lookupThrows)).toBe(false));
  it('blocks the metadata IP', async () => expect(await ok('http://169.254.169.254/', lookupThrows)).toBe(false));
  it('blocks decimal-encoded loopback', async () => expect(await ok('http://2130706433/', lookupThrows)).toBe(false));
  it('blocks userinfo bypass to a private host', async () =>
    expect(await ok('http://example.com@127.0.0.1/', lookupThrows)).toBe(false));
});

describe('checkSsrf — hostnames (mocked DNS)', () => {
  it('allows a host resolving to a public IP', async () =>
    expect(await ok('https://example.com/', lookupReturning('93.184.216.34'))).toBe(true));
  it('blocks a host resolving to a private IP', async () =>
    expect(await ok('https://intranet.example/', lookupReturning('10.1.2.3'))).toBe(false));
  it('blocks if ANY resolved IP is private', async () =>
    expect(await ok('https://mixed.example/', lookupReturning('93.184.216.34', '127.0.0.1'))).toBe(false));
  it('blocks when DNS fails', async () => expect(await ok('https://nope.example/', lookupThrows)).toBe(false));
  it('blocks when DNS returns nothing', async () =>
    expect(await ok('https://empty.example/', lookupReturning())).toBe(false));
});
