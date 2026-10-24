# Request to Eight Sleep: allowlist an OAuth redirect URI

Status: draft, not sent. Omar sends it from his own mailbox (to support@eightsleep.com, or a
developer/partnerships contact if one turns up). Keep it short; attach nothing.

---

**Subject:** OAuth client registration for a small Fajr-alarm integration

Hello Eight Sleep team,

I built a small free tool for Muslim Pod owners: it keeps one alarm on the Pod synced to Fajr
(dawn prayer) time in the user's city, every day. Source: https://github.com/OmarAlKhamis/fajr-eight.
Live: https://fajr-eight.omar-ab-kh.workers.dev.

Today the only way to connect is the password grant your mobile app uses, which means users type
their Eight Sleep password into my site. I would much rather send them to your hosted login.

Your authorization server already advertises the authorization-code + PKCE flow and client metadata
documents, but dynamic registration answers "these redirect_uris are not open to registration".
Could you allowlist this client so users can sign in on your page instead?

- Client metadata document: https://fajr-eight.omar-ab-kh.workers.dev/oauth-client.json
- Redirect URI: https://fajr-eight.omar-ab-kh.workers.dev/api/connect/callback
- Scopes needed: read_device, write_device (alarms only; we never read sleep data)
- Public client (PKCE, no secret)

The integration creates exactly one alarm per user and only ever edits that one. Happy to make any
changes you need, or to use a different process if you have one for small integrations.

Thank you,
Omar Al Khamis
omar.ab.kh@gmail.com
