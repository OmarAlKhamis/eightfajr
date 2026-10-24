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

## 4. Token storage: encrypted access + refresh tokens, never the password (2026-10-24, revised same day)
**Decision:** Connect exchanges email+password for tokens in memory and stores the access token AND
the refresh token, each AES-256-GCM encrypted (key in env), plus the access-token expiry. The sync
renews with the refresh grant when under 2 h remain, and retries once after an unexpected 401.
Password never persisted or logged.
**Why:** The real-account probe (Omar's Pod) showed the token endpoint returns
`{access_token, token_type, expires_in: 72000, refresh_token, userId, user_id, scope}`: 20-hour
access tokens and a working `grant_type=refresh_token` that rotates the refresh token (the old one
kept working too). Both reference clients ignore the refresh token and re-login with the password,
which we refuse to store. The original plan's fallback options (reconnect email vs. encrypted
password) are therefore unnecessary.
**Also learned:** `/users/me` has no top-level timezone; the Pod's zone is `currentDevice.timeZone`
(also `/devices/{id}.timezone`). Profile `features` lists `"alarms"`; `autopilotEnabled` is a
separate flag and alarms still listed fine with it off.

## 4b. Alarm API host and payload (2026-10-24)
**Decision:** Alarms go through `https://app-api.8slp.net` (`GET /v2/users/{id}/alarms`,
`POST /v1/users/{id}/alarms`, `PUT /v1/users/{id}/alarms/{alarmId}`) with the object shape
`{time, enabled, repeat, vibration{enabled,powerLevel,pattern}, thermal{enabled,level}, audio, smart, ...}`.
**Why:** eightctl issue #110 (2026-09-16) confirms `client-api.8slp.net/v1/users/{id}/alarms` is
retired (Express 404) and documents the live shape above; pyEight already used it. Unknown fields are
passed through on PUT and server-computed ones (`*Timestamp`, `*Until`) are stripped.
**Open:** DELETE and the PUT-vs-PATCH question are not verified against the live API yet; the probe
script's `--create`/`--delete` flags exist for that.

## 4c. Redirect ("Sign in with Eight Sleep") login: investigated, currently gated (2026-10-24)
**Finding:** `https://auth-api.8slp.net/.well-known/oauth-authorization-server` advertises a full
authorization-code + PKCE flow: hosted login at `/v1/ui/authorize`, `grant_types` authorization_code
+ refresh_token, scopes `read_sleep read_device write_device`, public clients (`none`), dynamic
registration at `/v1/oauth/register`, and client-id metadata documents. No open-source client uses it.
**Blocked:** registration answers `invalid_redirect_uri: these redirect_uris are not open to
registration` for localhost, 127.0.0.1, our workers.dev URL and a custom scheme; the authorize page
shows a generic error for the mobile app's client id and for a hosted metadata URL
(`/oauth-client.json`, kept in `client/public/` so it is ready if Eight Sleep allowlists us).
**Decision:** keep the password-grant connect (password in memory once, never stored) and ask Eight
Sleep to allowlist our redirect URI (draft in `docs/launch/eightsleep-oauth-request.md`). If granted,
`/api/connect/start` → their login page → `/api/connect/callback` replaces the password form; the rest
of the app is unchanged because tokens are already refresh-token based.
**Scope caveat:** the redirect flow offers no `write_sleep`; whether alarms need it is untested.

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
