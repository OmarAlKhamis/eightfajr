# Accounts registry (non-secrets only)

| Service | Purpose | Account / handle | Notes |
|---|---|---|---|
| GitHub | source | OmarAlKhamis/fajr-eight (public) | PolyForm Noncommercial |
| Cloudflare | Worker + D1 + cron | omar-ab-kh | deployed by `npm run deploy` (CLI); Workers Builds not connected yet |
| Resend | magic links + reconnect emails | omar.ab.kh@gmail.com (connector) | key `fajr-eight-production` (sending-only) on the Worker; test sender onboarding@resend.dev delivers only to the owner until a domain is verified |
| PostHog EU | product analytics, no PII | (to fill) | project key is public by design |
