#!/usr/bin/env node
// End-to-end API smoke test against a running dev server in mock mode (EIGHT_MOCK=1):
//   npm run dev            (in another terminal)
//   node script/smoke-test.mjs      # SMOKE_BASE=http://localhost:5173 by default
//
// Covers: magic-link sign-in → settings → connect → one-alarm invariant across
// hourly runs, settings changes, external deletion, pause/resume, transient and
// auth failures, reconnect, preview, feedback, admin gate, disconnect, logout.

const BASE = (process.env.SMOKE_BASE ?? "http://localhost:5173").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET ?? "dev-cron-secret";

let cookie = "";
let passed = 0;
let failed = 0;

function assert(cond, msg, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  }
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const session = setCookie.split(";")[0];
    if (session.startsWith("session=")) cookie = session.endsWith("=") ? "" : session;
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const RIYADH = {
  cityName: "Riyadh",
  countryCode: "SA",
  admin1: "Riyadh Region",
  lat: 24.6877,
  lng: 46.7219,
  timezone: "Asia/Riyadh",
  method: "UmmAlQura",
  offsetMinutes: -10,
  vibrationEnabled: true,
  vibrationPower: 50,
  thermalEnabled: true,
  thermalLevel: 0,
};

async function mockAlarms() {
  const r = await call("GET", "/api/dev/mock/alarms");
  return { list: r.json?.alarms?.["mock-user-1"] ?? [], calls: r.json?.calls ?? {} };
}

async function main() {
  console.log(`Smoke test → ${BASE}`);

  console.log("\n# health & auth gate");
  const health = await call("GET", "/api/health");
  assert(health.status === 200 && health.json?.ok === true, "health ok", health.json);
  if (!health.json?.mock) {
    console.log("  ! server is not in mock mode (EIGHT_MOCK=1) — aborting to avoid touching a real Pod");
    process.exit(2);
  }
  assert((await call("GET", "/api/auth/me")).status === 401, "me → 401 when signed out");
  assert((await call("GET", "/api/config")).json?.mock === true, "config exposes mock flag");

  console.log("\n# magic link");
  const email = `smoke+${Date.now()}@example.com`;
  const ml = await call("POST", "/api/auth/magic-link", { email, locale: "ar" });
  assert(ml.status === 200 && ml.json?.mode === "logged", "magic link issued (dev logged mode)", ml.json);
  assert((await call("POST", "/api/auth/magic-link", { email: "nope" })).status === 400, "rejects bad email");
  const last = await call("GET", "/api/dev/last-magic-link");
  const token = new URL(last.json?.url ?? "http://x/?token=").searchParams.get("token");
  assert(last.json?.email === email && token && token.length > 20, "dev endpoint exposes the link", last.json);
  const verify = await call("POST", "/api/auth/verify", { token, locale: "ar" });
  assert(verify.status === 200 && cookie.startsWith("session="), "verify sets a session cookie", verify.json);
  const savedCookie = cookie;
  cookie = "";
  assert((await call("POST", "/api/auth/verify", { token, locale: "ar" })).status === 400, "token is single-use");
  cookie = savedCookie;
  let me = await call("GET", "/api/auth/me");
  assert(me.status === 200 && me.json?.user?.email === email && me.json?.connection === null && me.json?.settings === null, "me → fresh user", me.json);

  console.log("\n# settings before connecting");
  const s1 = await call("PUT", "/api/settings", RIYADH);
  assert(s1.status === 200 && s1.json?.sync === null, "settings saved; no sync while not connected", s1.json);
  assert((await call("PUT", "/api/settings", { ...RIYADH, offsetMinutes: 500 })).status === 400, "offset validated (-60..60)");
  assert((await call("PUT", "/api/settings", { ...RIYADH, timezone: "Mars/Olympus" })).status === 400, "timezone validated");
  assert((await call("POST", "/api/sync/now")).status === 400, "sync now refused when not connected");

  console.log("\n# connect");
  const bad = await call("POST", "/api/connect", { email: "demo@example.com", password: "wrong" });
  assert(bad.status === 401 && bad.json?.error === "INVALID_CREDENTIALS", "wrong password → INVALID_CREDENTIALS", bad.json);
  const ok = await call("POST", "/api/connect", { email: "demo@example.com", password: "demo-password" });
  assert(ok.status === 200 && ok.json?.eightTimezone === "Asia/Riyadh", "connected with account timezone", ok.json);
  assert(ok.json?.sync?.result === "created", "first sync created the alarm", ok.json?.sync);
  assert(/^\d{2}:\d{2}:00$/.test(ok.json?.sync?.scheduledLocal ?? ""), "alarm time is HH:MM:00 local", ok.json?.sync);
  let alarms = await mockAlarms();
  assert(alarms.list.length === 1 && alarms.list[0].time === ok.json.sync.scheduledLocal && alarms.list[0].enabled === true, "exactly one enabled alarm on the Pod", alarms.list);
  const firstAlarmId = alarms.list[0]?.id;
  me = await call("GET", "/api/auth/me");
  assert(me.json?.connection?.status === "connected" && me.json?.alarm?.scheduledLocal === ok.json.sync.scheduledLocal && me.json?.nextAlarm?.alarmMs > Date.now(), "me shows connection, alarm and next alarm", me.json);
  assert(me.json?.lastSync?.result === "created" && me.json?.lastSync?.trigger === "connect", "last sync recorded", me.json?.lastSync);

  console.log("\n# idempotency across hourly runs");
  assert((await call("POST", "/api/sync/run")).status === 403, "cron endpoint needs the secret");
  const run1 = await call("POST", "/api/sync/run", undefined, { "x-cron-secret": CRON_SECRET });
  const callsBefore = (await mockAlarms()).calls;
  const run2 = await call("POST", "/api/sync/run", undefined, { "x-cron-secret": CRON_SECRET });
  const callsAfter = (await mockAlarms()).calls;
  assert(run1.status === 200 && run2.status === 200, "cron runs succeed", { run1: run1.json, run2: run2.json });
  assert(run1.json?.due === 0 && run2.json?.due === 0, "user is not due while the alarm is in the future", { run1: run1.json, run2: run2.json });
  assert(JSON.stringify(callsBefore) === JSON.stringify(callsAfter), "second run made no Eight Sleep calls", { callsBefore, callsAfter });
  const now1 = await call("POST", "/api/sync/now");
  assert(now1.json?.sync?.result === "updated", "manual sync (force) updates in place", now1.json);
  alarms = await mockAlarms();
  assert(alarms.list.length === 1 && alarms.list[0].id === firstAlarmId, "still exactly one alarm, same id", alarms.list);

  console.log("\n# settings change applies immediately");
  const s2 = await call("PUT", "/api/settings", { ...RIYADH, offsetMinutes: 15, vibrationPower: 100 });
  assert(s2.status === 200 && s2.json?.sync?.result === "updated", "settings change → updated", s2.json?.sync);
  alarms = await mockAlarms();
  assert(alarms.list.length === 1 && alarms.list[0].time === s2.json.sync.scheduledLocal && alarms.list[0].vibration?.powerLevel === 100, "Pod alarm reflects new offset and vibration", alarms.list);
  const beforeMs = Date.parse(ok.json.sync.scheduledForUtc);
  const afterMs = Date.parse(s2.json.sync.scheduledForUtc);
  assert(afterMs - beforeMs === 25 * 60_000, "offset -10 → +15 moved the alarm by exactly 25 minutes", { beforeMs, afterMs });

  console.log("\n# deleted in the Eight Sleep app → recreated once");
  assert((await call("POST", "/api/dev/mock/delete-alarm", { userId: "mock-user-1" })).json?.ok === true, "alarm deleted externally");
  const rec = await call("POST", "/api/sync/now");
  assert(rec.json?.sync?.result === "recreated", "sync recreated the alarm", rec.json);
  alarms = await mockAlarms();
  assert(alarms.list.length === 1 && alarms.list[0].id !== firstAlarmId, "one alarm with a new id", alarms.list);
  me = await call("GET", "/api/auth/me");
  assert(me.json?.alarm?.recreatedCount === 1, "recreatedCount = 1", me.json?.alarm);

  console.log("\n# pause / resume");
  const p = await call("POST", "/api/settings/pause", { paused: true });
  assert(p.json?.paused === true && p.json?.sync?.result === "paused", "pause → paused", p.json);
  alarms = await mockAlarms();
  assert(alarms.list.length === 1 && alarms.list[0].enabled === false, "Pod alarm disabled (not deleted)", alarms.list);
  me = await call("GET", "/api/auth/me");
  assert(me.json?.settings?.paused === true && me.json?.nextAlarm === null, "me reports paused, no next alarm", { paused: me.json?.settings?.paused, next: me.json?.nextAlarm });
  const r = await call("POST", "/api/settings/pause", { paused: false });
  assert(r.json?.paused === false && r.json?.sync?.result === "updated", "resume → updated", r.json);
  alarms = await mockAlarms();
  assert(alarms.list.length === 1 && alarms.list[0].enabled === true, "Pod alarm re-enabled", alarms.list);

  console.log("\n# transient failure then recovery");
  await call("POST", "/api/dev/mock/fail-next", { op: "listAlarms", code: "RATE_LIMITED" });
  const f1 = await call("POST", "/api/sync/now");
  assert(f1.status === 200 && f1.json?.ok === false && f1.json?.sync?.errorCode === "RATE_LIMITED", "429 surfaces as RATE_LIMITED", f1.json);
  me = await call("GET", "/api/auth/me");
  assert(me.json?.connection?.consecutiveFailures === 1 && me.json?.connection?.status === "connected" && me.json?.lastSync?.result === "failed", "failure counted, still connected", me.json?.connection);
  const f2 = await call("POST", "/api/sync/now");
  assert(f2.json?.sync?.result === "updated", "next sync recovers", f2.json);
  me = await call("GET", "/api/auth/me");
  assert(me.json?.connection?.consecutiveFailures === 0, "failure counter reset", me.json?.connection);

  console.log("\n# token revoked → needs reconnect → reconnect");
  await call("POST", "/api/dev/mock/revoke");
  const f3 = await call("POST", "/api/sync/now");
  assert(f3.json?.sync?.errorCode === "AUTH_FAILED", "401 → AUTH_FAILED", f3.json);
  me = await call("GET", "/api/auth/me");
  assert(me.json?.connection?.status === "needs_reconnect", "status needs_reconnect", me.json?.connection);
  const run3 = await call("POST", "/api/sync/run", undefined, { "x-cron-secret": CRON_SECRET });
  assert(run3.json?.due === 0, "cron skips users who need to reconnect", run3.json);
  const re = await call("POST", "/api/connect", { email: "demo@example.com", password: "demo-password" });
  assert(re.status === 200 && re.json?.sync?.result === "updated", "reconnect restores and re-syncs", re.json);
  me = await call("GET", "/api/auth/me");
  assert(me.json?.connection?.status === "connected" && me.json?.connection?.consecutiveFailures === 0, "connected again", me.json?.connection);
  alarms = await mockAlarms();
  assert(alarms.list.length === 1, "still exactly one alarm after all of that", alarms.list);

  console.log("\n# preview, feedback, admin gate");
  const pv = await call("GET", "/api/preview?lat=24.6877&lng=46.7219&timezone=Asia/Riyadh&method=UmmAlQura&offsetMinutes=-10&days=7");
  assert(pv.status === 200 && pv.json?.entries?.length === 7 && pv.json.entries.every((e) => e.alarmMs === e.fajrMs - 600_000), "7-day preview with offset applied", pv.json);
  assert((await call("GET", "/api/preview?lat=1&lng=2&timezone=Asia/Riyadh&method=Nope")).status === 400, "preview validates method");
  assert((await call("POST", "/api/feedback", { rating: "up", comment: "smoke", page: "settings", locale: "ar" })).json?.ok === true, "feedback stored");
  assert((await call("POST", "/api/feedback", { rating: "meh" })).status === 400, "feedback validates rating");
  assert((await call("GET", "/api/admin/stats")).status === 403, "admin stats forbidden for non-admin");

  console.log("\n# disconnect deletes alarm + data");
  const d = await call("DELETE", "/api/connect");
  assert(d.status === 200 && d.json?.alarmRemoved === true, "disconnect removed the Pod alarm", d.json);
  alarms = await mockAlarms();
  assert(alarms.list.length === 0, "no alarms left on the Pod", alarms.list);
  me = await call("GET", "/api/auth/me");
  assert(me.json?.connection === null && me.json?.settings === null && me.json?.alarm === null, "connection, settings and alarm deleted", me.json);

  console.log("\n# logout");
  await call("POST", "/api/auth/logout");
  assert((await call("GET", "/api/auth/me")).status === 401, "me → 401 after logout");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke test crashed:", e);
  process.exit(1);
});
