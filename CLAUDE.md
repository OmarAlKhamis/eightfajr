# CLAUDE.md — agent context for Eight Fajr (منبّه الفجر)

## What it is
Free web app that keeps exactly ONE alarm on a user's Eight Sleep Pod synced to Fajr
time (+/- offset) in their chosen city, every day. Eight Sleep has no public API; the
integration mirrors the open-source clients `steipete/eightctl` and `lukas-clarke/eight_sleep`.

## Architecture
- **Frontend**: React 19 + Vite, wouter, TanStack Query, Tailwind 4. Arabic (RTL) default, English toggle. Mobile-first.
- **Backend**: Hono on Cloudflare Workers. Magic-link sign-in (Resend) + signed-cookie sessions (hono/cookie).
- **Database**: Cloudflare D1 via Drizzle; migrations in `migrations/` (`npm run db:migrate` local, `db:migrate:prod`).
- **Scheduler**: Cron Trigger `0 * * * *` → `server/cron.ts` → `server/sync.ts` (idempotent).
- **Eight Sleep**: isolated in `eightsleep/` (auth, getMe, listAlarms, createAlarm, updateAlarm, deleteAlarm, serial queue + backoff, mock). Fix API drift there only.
- **Fajr**: pure logic in `shared/fajr.ts` (adhan + Intl time zones), methods/country defaults in `shared/methods.ts`.

## Key files
- `shared/schema.ts` — users, magic_links, eight_connections, alarm_settings, managed_alarms, sync_log, feedback
- `server/sync.ts` — syncUser(): the ONE-alarm invariant lives here
- `server/routes/*.ts` — auth, connect, settings, sync, admin, feedback
- `client/src/i18n/` — all UI strings (ar default, en)
- `script/smoke-test.mjs` — full API flow against a running dev server with EIGHT_MOCK=1
- `script/eight-probe.mjs` — real-account probe (token lifetime, alarm JSON shape); secrets redacted

## Core invariants (do not break)
1. Exactly one managed alarm per user; never create when `managed_alarms.eight_alarm_id` exists and is still on the account. Recreate at most once per sync when it was deleted in the Eight Sleep app.
2. Sync is idempotent: same inputs → `skipped`, no API write.
3. The Eight Sleep password is used in memory at connect time only — never stored, never logged. Tokens are AES-256-GCM encrypted at rest (`server/crypto.ts`).
4. Alarm `time` is wall-clock in the Eight Sleep account's timezone; Fajr is computed in the city's timezone. Convert, don't assume they match.
5. Analytics carry no PII: hashed distinct_id, country/method/offset-bucket only.
6. Arabic copy uses everyday family register (شارك not بشّر).

## Dev workflow
- `cp .dev.vars.example .dev.vars` then `npm run db:migrate` (first time), `npm run dev` (:5173).
- `npm run check` typecheck · `npm test` unit tests · `node script/smoke-test.mjs` (server running).
- Schema change → edit `shared/schema.ts` → `npm run db:generate` → `npm run db:migrate`.
- Deploy: push to `main` (Workers Builds) or `npm run deploy`.
