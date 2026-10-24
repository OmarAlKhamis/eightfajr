# Accounts registry (non-secrets only)

| Service | Purpose | Account / handle | Notes |
|---|---|---|---|
| GitHub | source | OmarAlKhamis/eightfajr (public) | PolyForm Noncommercial |
| Cloudflare | Worker `eightfajr` + D1 `eightfajr` + cron, zone eightfajr.com | omar-ab-kh | deployed by `npm run deploy` (CLI); Workers Builds not connected yet; old `fajr-eight` Worker/D1 to delete |
| Domain | eightfajr.com | Cloudflare Registrar (bought 2026-10-24) | apex + www on the Worker; Resend sending domain (eu-west-1) |
| Resend | magic links + reconnect emails | omar.ab.kh@gmail.com (connector) | key `fajr-eight-production` (sending-only) on the Worker; domain eightfajr.com verified (eu-west-1), sender `Eight Fajr <no-reply@eightfajr.com>`; DNS via Omar's Cloudflare DNS-edit token in .local |
| PostHog EU | product analytics, no PII | (to fill) | project key is public by design |
