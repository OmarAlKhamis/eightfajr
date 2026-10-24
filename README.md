# Eight Fajr · منبّه الفجر

Eight Fajr keeps **one** alarm on your Eight Sleep Pod synced to Fajr time in your city, every day, automatically.
Free, bilingual (Arabic default / English), mobile-first. Not affiliated with Eight Sleep.

> Eight Sleep has no public API. This project mirrors the private endpoints documented by the
> open-source clients [steipete/eightctl](https://github.com/steipete/eightctl) and
> [lukas-clarke/eight_sleep](https://github.com/lukas-clarke/eight_sleep). It can break whenever
> Eight Sleep changes something; everything API-specific lives in [`eightsleep/`](eightsleep) so it
> can be fixed in one place.

## How it works

1. Sign in with a magic link (email only, no password).
2. Connect your Eight Sleep account: email + password are exchanged **once** for an access token.
   The password is never stored or logged; the token is AES-256-GCM encrypted at rest.
3. Pick a city (34k GeoNames cities, or "use my location"), a calculation method (defaulted from the
   country) and an offset of −60…+60 minutes.
4. An hourly Cloudflare Cron Trigger moves the same alarm to the next Fajr once today's has passed.
   The sync is idempotent and never creates a second alarm; if you delete it in the Eight Sleep app it
   is recreated once.

Pause switches the Pod alarm off. Disconnect deletes the alarm from the Pod, then deletes the token
and all data.

## Stack

React 19 + Vite + Tailwind 4 · Hono on Cloudflare Workers · D1 (Drizzle) · Cron Triggers ·
[adhan](https://github.com/batoulapps/adhan-js) for prayer times · Resend for email ·
PostHog EU for privacy-first analytics (no PII).

```
client/      React SPA (pages, components, i18n/{ar,en}.ts)
server/      Hono API, magic-link auth, sync engine (sync.ts), hourly cron (cron.ts)
eightsleep/  isolated Eight Sleep client, serial queue + backoff, in-memory mock
shared/      fajr.ts (pure prayer-time + offset logic), methods.ts, cities.ts, schema.ts (Drizzle)
script/      build-cities.mjs, smoke-test.mjs, eight-probe.mjs
migrations/  D1 SQL migrations
docs/        DECISIONS.md (why), ROADMAP.md, launch/accounts.md
```

## Local development

Requirements: Node ≥ 22, npm.

```bash
npm install
cp .dev.vars.example .dev.vars     # mocked Eight Sleep API by default (EIGHT_MOCK=1)
npm run db:migrate                 # local D1 (first time, and after new migrations)
npm run dev                        # http://localhost:5173 — client + Worker + local D1 in one process
```

Without `RESEND_API_KEY` the magic link is printed to the dev console and shown on the sign-in page.
The mock Eight Sleep account is `demo@example.com` / `demo-password` (see `eightsleep/mock.ts`).

### Tests

```bash
npm run check        # TypeScript
npm test             # Vitest: Fajr across methods/zones/DST, Eight Sleep client, crypto, sync idempotency
npm run test:smoke   # full API flow against the running dev server (mock mode)
```

### Against your real Pod (optional, read-only by default)

```bash
cp .env.example .env               # EIGHT_EMAIL, EIGHT_PASSWORD, EIGHT_CLIENT_SECRET
npm run eight:probe                # prints token lifetime, profile time zone, alarm JSON (secrets redacted)
```

Then set `EIGHT_MOCK=0` and `EIGHT_CLIENT_SECRET` in `.dev.vars` to run the app against the real API.
The public app `client_id` is in `.dev.vars.example`; the matching secret is the one embedded in the
reference clients linked above (not committed here).

## Configuration

Worker variables (dashboard secrets in production, `.dev.vars` locally; see `.dev.vars.example`):

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | signs the session cookie |
| `TOKEN_ENCRYPTION_KEY` | base64 of 32 random bytes; AES-256-GCM key for Eight Sleep tokens |
| `EIGHT_CLIENT_ID`, `EIGHT_CLIENT_SECRET` | Eight Sleep public app OAuth client |
| `EIGHT_MOCK` | `1` = in-memory fake API (dev/CI) |
| `RESEND_API_KEY`, `EMAIL_FROM` | magic links + "needs reconnect" emails |
| `ADMIN_EMAIL` | the only account allowed on `/admin` |
| `POSTHOG_KEY`, `POSTHOG_HOST`, `ANALYTICS_SALT` | analytics (optional) |
| `CRON_SECRET` | lets `POST /api/sync/run` trigger the hourly job manually (`x-cron-secret` header) |
| `APP_ORIGIN` | public origin used in emails |

## Deploy (Cloudflare)

1. Create the production database and paste its id into `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create eightfajr
   ```
2. Apply migrations: `npm run db:migrate:prod`.
3. Generate secrets locally (never commit them):
   ```bash
   node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
   node -e "console.log('TOKEN_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))"
   node -e "console.log('CRON_SECRET='+require('crypto').randomBytes(24).toString('hex'))"
   ```
4. In the Cloudflare dashboard: Workers & Pages → Create → connect this GitHub repo (Workers Builds).
   Build command `npm run build`, deploy command `npx wrangler deploy -c dist/eightfajr/wrangler.json`.
   Add the variables above under Settings → Variables and Secrets.
5. Every push to `main` builds and deploys. The cron trigger (`0 * * * *`) is created from `wrangler.jsonc`.
   Manual deploy: `npm run deploy`.
6. Verify: open `/api/health`, sign in, connect, and check Workers → Logs for the hourly `hourly sync` line.

## Privacy

See the in-app privacy page (`/privacy`). Summary: email, city, preferences, one alarm id, a sync log,
and an encrypted Eight Sleep token. Never the password. Analytics are hashed and coarse. Disconnect
deletes everything immediately.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE) — use, copy, modify and share freely for noncommercial
purposes, keep the attribution. Commercial use needs a separate licence from the author.
City data © [GeoNames](https://www.geonames.org) (CC BY 4.0).
