# Shortly — a reliable URL shortener

A small, reliable URL shortener with a REST API, a plain HTML/CSS/JS frontend, a
local-file database, and real input **guardrails**. Built with **Express 5 +
TypeScript** and Node's built-in **`node:sqlite`** (no native modules to compile).

## Features

- Shorten any http/https URL; optional custom alias.
- Fast 302 redirects with per-link **click counting**.
- Recent-links history with copy-to-clipboard.
- Four built-in guardrails (below).
- Layered, dependency-injected design with unit, API, and end-to-end tests.

## Guardrails

| # | Guardrail | What it does |
|---|-----------|--------------|
| 1 | **URL validation** | Accepts only well-formed `http`/`https` URLs ≤ 2048 chars; rejects `javascript:`, `data:`, `file:`, etc. |
| 2 | **SSRF / open-redirect** | Resolves the host and blocks loopback, private, link-local (incl. `169.254.169.254`), unique-local, reserved, multicast and CGNAT addresses — across IPv4, IPv6, IPv4-mapped IPv6, and obfuscated (decimal/octal/hex) encodings. Only ever redirects to the stored, validated target. |
| 3 | **Per-IP rate limiting** | Throttles `POST /api/shorten` and overall traffic (configurable). |
| 4 | **Malicious-URL screening** | Pluggable. Defaults to a local, no-network heuristic so it always works; Google Safe Browsing is opt-in (see caveat below). |

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000  (auto-reload)
```

Or run the compiled build:

```bash
npm run build
npm start
```

> **Requires Node ≥ 22.5** — the app uses the built-in `node:sqlite` module.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start with auto-reload (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Unit + API tests (vitest) |
| `npm run test:e2e` | End-to-end browser tests (Playwright) |
| `npm run typecheck` | Type-check without emitting |

## API

| Method / path | Description |
|---------------|-------------|
| `POST /api/shorten` | Body `{ "url": "...", "alias?": "..." }` → `201 { code, shortUrl, target, createdAt, clickCount }` |
| `GET /:code` | `302` redirect to the target (records a click) |
| `GET /api/urls` | List recent links |
| `GET /api/urls/:code` | Stats for one link |
| `GET /healthz` | Health check |

Errors use a single shape: `{ "error": { "code", "message" } }` (e.g. `INVALID_URL`,
`PRIVATE_ADDRESS`, `BLOCKED_URL`, `ALIAS_TAKEN`, `RATE_LIMITED`, `NOT_FOUND`).

## Configuration

Copy `.env.example` to `.env` (all values are optional and have safe defaults):

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3000` | |
| `BASE_URL` | `http://localhost:3000` | Used to build short URLs |
| `TRUST_PROXY` | `0` | Number of trusted proxies — never a blanket `true` |
| `DATABASE_PATH` | `./data/urls.db` | `:memory:` for an ephemeral DB |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `20` | Limit on `POST /api/shorten` |
| `GLOBAL_RATE_LIMIT_MAX` | `300` | Overall per-window limit |
| `SCREENING_PROVIDER` | `local` | `local` (no network) or `safebrowsing` |
| `SCREENING_FAIL_OPEN` | `true` | Allow (true) or block (false) when the screener errors |
| `SAFE_BROWSING_API_KEY` | — | Required only for `safebrowsing` |

### ⚠️ Safe Browsing caveat

Google **Safe Browsing v4 is deprecated (sunset 2027-03-31) and licensed for
non-commercial use only.** Commercial use must migrate to the paid **Web Risk API**.
Screening therefore defaults to the local heuristic; enabling Safe Browsing is a
deliberate, human-owned decision.

## Project structure

```
src/
  server.ts            bootstrap + graceful shutdown
  app.ts               createApp({ db }) factory (testable)
  config.ts            env config (resilient: bad values fall back to defaults)
  db/index.ts          node:sqlite connection, pragmas, migration
  guardrails/          validateUrl.ts · ssrf.ts · screener.ts
  services/            shortcode.ts · urlService.ts
  middleware/          rateLimit.ts · errorHandler.ts
public/                index.html · styles.css · app.js   (no inline JS; strict CSP)
tests/                 unit/ · api/ · e2e/
```

## Testing

```bash
npm test            # 64 unit + API tests (incl. a 30-case SSRF matrix)
npm run test:e2e    # Playwright via system Edge (no browser download needed)
```

## Notes on the database

This project uses Node's built-in **`node:sqlite`** (real SQLite, single local
file, WAL mode) instead of a native driver such as `better-sqlite3`. Native addons
require a C++ toolchain and a prebuilt-binary download that are unavailable in some
locked-down environments; `node:sqlite` is built into Node 22 and needs no install,
while providing the same SQL, `RETURNING`, and durability guarantees.
