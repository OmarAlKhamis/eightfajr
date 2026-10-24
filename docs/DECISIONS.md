# Decisions

Every architecture choice gets an entry: the why AND the rejected alternatives.

## 1. Cloudflare Workers + D1 + Cron Triggers (2026-10-24)
**Decision:** Vite + React 19 + Hono on one Cloudflare Worker, D1 for data, hourly Cron Trigger.
**Why:** The original brief said Next.js on Vercel with Vercel Cron, but Vercel's Hobby plan only allows
cron jobs once per day (hourly expressions fail at deploy). Cloudflare gives free hourly crons and is
the stack already proven by Ramadan Challenge v2.
**Rejected:** Vercel Pro (~$20/mo for a free product); Supabase pg_cron pinging a Vercel route (two
providers for one job); cron-job.org (another account to manage); Next.js on Workers via OpenNext
(extra adapter, more moving parts for no product gain).

## 2. No Supabase; own magic-link auth (2026-10-24)
**Decision:** Users table in D1; magic links sent by Resend; stateless signed-cookie sessions.
**Why:** Once on Cloudflare, Supabase would be a second backend only for auth. Magic link is ~80 lines.
**Rejected:** Supabase Auth, Clerk, Cloudflare Access (not for public consumer sign-in).

## 3. Public repo under PolyForm Noncommercial 1.0.0 (2026-10-24)
**Decision:** Source is public; anyone may use, fix and improve it noncommercially with attribution.
**Why:** Omar wants the community to keep it working as Eight Sleep's private API drifts, while
reserving commercial use. Strictly this is "source-available", not OSI open source.
**Rejected:** MIT (allows commercial use); CC BY-NC (written for content, not code).

## 4. Token storage: encrypted access token, no password (2026-10-24)
**Decision:** Connect exchanges email+password for an access token in memory, stores only the token
(AES-256-GCM, key in env) plus its expiry. Password never persisted or logged.
**Why:** Eight Sleep's token endpoint is an OAuth password grant that returns `access_token`,
`expires_in`, `userId`; neither reference client receives or uses a refresh token.
**Open:** real token lifetime is unknown until measured with `script/eight-probe.mjs`. If tokens turn
out short-lived, the options are (a) email the user to reconnect when it expires, or (b) store the
password encrypted with explicit, visible consent. Decide after the real-data pass.

## 4b. Alarm API host and payload (2026-10-24)
**Decision:** Alarms go through `https://app-api.8slp.net` (`GET /v2/users/{id}/alarms`,
`POST /v1/users/{id}/alarms`, `PUT /v1/users/{id}/alarms/{alarmId}`) with the object shape
`{time, enabled, repeat, vibration{enabled,powerLevel,pattern}, thermal{enabled,level}, audio, smart, ...}`.
**Why:** eightctl issue #110 (2026-09-16) confirms `client-api.8slp.net/v1/users/{id}/alarms` is
retired (Express 404) and documents the live shape above; pyEight already used it. Unknown fields are
passed through on PUT and server-computed ones (`*Timestamp`, `*Until`) are stripped.
**Open:** DELETE and the PUT-vs-PATCH question are not verified against the live API yet; the probe
script's `--create`/`--delete` flags exist for that.

## 5. Alarm time zone: compute in city tz, push in account tz (2026-10-24)
**Decision:** Fajr instant is computed for the chosen city's IANA zone; the alarm `time` string sent
to Eight Sleep is that instant formatted in the Eight Sleep account's `timezone` (from `/users/me`).
**Why:** Pod alarms are wall-clock in the account's zone. Travellers and mismatched profiles would
otherwise ring at the wrong hour. The UI warns when the two zones differ.

## 6. Cities: bundled GeoNames cities15000 as static JSON (2026-10-24)
**Decision:** `script/build-cities.mjs` compacts GeoNames into `data/cities.json` (~25k cities with
IANA tz), lazy-loaded by the settings page; search and nearest-city run client-side.
**Why:** No DB round-trips, works offline once cached, trivial to update.
**Rejected:** D1 table + trigram search (more code, no benefit at this size); a geocoding API (quota, PII).
