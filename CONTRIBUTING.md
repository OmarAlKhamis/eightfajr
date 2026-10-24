# Contributing

Thanks for helping keep Fajr alarms working on Eight Sleep Pods.

## Ground rules
- Licence: PolyForm Noncommercial 1.0.0. By contributing you agree your changes are licensed the same way.
- Never commit secrets, real Eight Sleep credentials, or personal data. `.dev.vars` and `.local/` are gitignored for a reason.
- Arabic UI copy uses an everyday, warm register (شارك not بشّر). Both `ar` and `en` strings must be added together.

## Setup
```bash
npm install
cp .dev.vars.example .dev.vars   # mocked Eight Sleep API by default (EIGHT_MOCK=1)
npm run db:migrate
npm run dev                      # http://localhost:5173
```

## Before opening a PR
```bash
npm run check && npm test && npm run build
node script/smoke-test.mjs       # with `npm run dev` running
```

## Eight Sleep API changed?
Everything that touches Eight Sleep lives in `eightsleep/`. Run `npm run eight:probe` with your own
account (credentials in `.env`, see `.env.example`) to see the current alarm JSON shape, then fix
`eightsleep/client.ts` + `eightsleep/types.ts` and extend `eightsleep/client.test.ts`.
