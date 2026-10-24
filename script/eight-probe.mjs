#!/usr/bin/env node
// Real-account probe for the Eight Sleep private API. Read-only by default.
//
//   cp .env.example .env   # fill EIGHT_EMAIL / EIGHT_PASSWORD / EIGHT_CLIENT_SECRET
//   npm run eight:probe                 # login → /users/me → list alarms
//   npm run eight:probe -- --create 04:30:00   # also create a one-off alarm (then delete it with --delete <id>)
//   npm run eight:probe -- --delete <alarmId>
//
// Prints: token lifetime (expires_in) and whether a refresh_token is returned,
// the profile time zone, and the raw alarm JSON shape (ids shortened). It never
// prints the token, the password, or your email.

import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env */
  }
}
loadEnv();

const { EIGHT_EMAIL, EIGHT_PASSWORD, EIGHT_CLIENT_ID = "0894c7f33bb94800a03f1f4df13a4f38", EIGHT_CLIENT_SECRET } = process.env;
if (!EIGHT_EMAIL || !EIGHT_PASSWORD || !EIGHT_CLIENT_SECRET) {
  console.error("Set EIGHT_EMAIL, EIGHT_PASSWORD and EIGHT_CLIENT_SECRET in .env (see .env.example).");
  process.exit(2);
}

const args = process.argv.slice(2);
const createAt = args.includes("--create") ? args[args.indexOf("--create") + 1] : null;
const deleteId = args.includes("--delete") ? args[args.indexOf("--delete") + 1] : null;

const H = { "content-type": "application/json; charset=UTF-8", accept: "application/json", "user-agent": "okhttp/4.9.3" };
const short = (id) => (typeof id === "string" && id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

function redact(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (/token|password|secret/i.test(k)) return "[redacted]";
      if (k === "id" || /Id$/.test(k)) return short(v);
      if (k === "email") return "[redacted]";
      return v;
    }),
  );
}

async function main() {
  const t0 = Date.now();
  const res = await fetch("https://auth-api.8slp.net/v1/tokens", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ client_id: EIGHT_CLIENT_ID, client_secret: EIGHT_CLIENT_SECRET, grant_type: "password", username: EIGHT_EMAIL, password: EIGHT_PASSWORD }),
  });
  const auth = await res.json().catch(() => ({}));
  console.log(`login: HTTP ${res.status} in ${Date.now() - t0} ms`);
  if (!res.ok) {
    console.log(redact(auth));
    process.exit(1);
  }
  console.log("  keys:", Object.keys(auth).join(", "));
  console.log("  expires_in:", auth.expires_in, auth.expires_in ? `(≈ ${(auth.expires_in / 86400).toFixed(1)} days)` : "");
  console.log("  refresh_token present:", "refresh_token" in auth);
  const token = auth.access_token;
  const userId = auth.userId ?? auth.user_id;
  const A = { ...H, authorization: `Bearer ${token}` };

  if (auth.refresh_token) {
    const rr = await fetch("https://auth-api.8slp.net/v1/tokens", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ client_id: EIGHT_CLIENT_ID, client_secret: EIGHT_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: auth.refresh_token }),
    });
    const rj = await rr.json().catch(() => ({}));
    console.log(`\nrefresh grant: HTTP ${rr.status}`);
    console.log("  keys:", Object.keys(rj).join(", "));
    console.log("  expires_in:", rj.expires_in, "rotated refresh_token:", !!rj.refresh_token && rj.refresh_token !== auth.refresh_token);
  }

  const me = await fetch("https://client-api.8slp.net/v1/users/me", { headers: A });
  const meJson = await me.json().catch(() => ({}));
  const user = meJson.user ?? meJson;
  console.log(`\n/users/me: HTTP ${me.status}`);
  console.log("  currentDevice.timeZone:", user.currentDevice?.timeZone ?? "(none)", "| top-level timezone:", user.timezone ?? "(none)");
  console.log("  features:", JSON.stringify(user.features), "autopilotEnabled:", user.autopilotEnabled);
  console.log("  keys:", Object.keys(user).join(", "));

  const list = await fetch(`https://app-api.8slp.net/v2/users/${userId}/alarms`, { headers: A });
  const listJson = await list.json().catch(() => ({}));
  console.log(`\nGET v2 alarms: HTTP ${list.status}`);
  console.log(JSON.stringify(redact(listJson), null, 2).slice(0, 4000));

  if (createAt) {
    const body = { time: createAt, enabled: true, vibration: { enabled: true, powerLevel: 50, pattern: "RISE" }, thermal: { enabled: true, level: 0 } };
    const c = await fetch(`https://app-api.8slp.net/v1/users/${userId}/alarms`, { method: "POST", headers: A, body: JSON.stringify(body) });
    const cJson = await c.json().catch(() => ({}));
    console.log(`\nPOST v1 alarms (${createAt}): HTTP ${c.status}`);
    console.log(JSON.stringify(redact(cJson), null, 2).slice(0, 2000));
    const created = cJson.alarm ?? cJson;
    if (created?.id) console.log(`\n  created alarm id (full, for --delete): ${created.id}`);
  }

  if (deleteId) {
    const d = await fetch(`https://app-api.8slp.net/v1/users/${userId}/alarms/${deleteId}`, { method: "DELETE", headers: A });
    console.log(`\nDELETE alarm ${short(deleteId)}: HTTP ${d.status}`);
  }
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
