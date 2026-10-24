import { beforeEach, describe, expect, it } from "vitest";
import { EightSleepError, MockEightSleep } from "@eightsleep/index";
import type { AlarmSettings, EightConnection, ManagedAlarm, SyncLogEntry, User } from "@shared/schema";
import { fajrOn, formatTimeInTz } from "@shared/fajr";
import type { SyncStore } from "./storage";
import { FAILURES_BEFORE_ATTENTION, removeManagedAlarm, syncUser, type SyncDeps } from "./sync";

// In-memory SyncStore: exactly the slice server/sync.ts depends on.
class MemoryStore implements SyncStore {
  users = new Map<string, User>();
  connections = new Map<string, EightConnection>();
  settings = new Map<string, AlarmSettings>();
  managed = new Map<string, ManagedAlarm>();
  log: Omit<SyncLogEntry, "id">[] = [];

  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async getConnection(userId: string) {
    return this.connections.get(userId) ?? null;
  }
  async updateConnection(userId: string, patch: Partial<Omit<EightConnection, "userId">>) {
    const c = this.connections.get(userId);
    if (c) this.connections.set(userId, { ...c, ...patch });
  }
  async getSettings(userId: string) {
    return this.settings.get(userId) ?? null;
  }
  async getManaged(userId: string) {
    return this.managed.get(userId) ?? null;
  }
  async upsertManaged(row: ManagedAlarm) {
    this.managed.set(row.userId, row);
  }
  async deleteManaged(userId: string) {
    this.managed.delete(userId);
  }
  async insertSync(entry: Omit<SyncLogEntry, "id">) {
    this.log.push(entry);
  }
}

const USER = "user-1";
const RIYADH_FAJR_OCT24 = fajrOn({ year: 2026, month: 10, day: 24 }, { lat: 24.7136, lng: 46.6753, timezone: "Asia/Riyadh", method: "UmmAlQura", offsetMinutes: 0 });

function baseSettings(over: Partial<AlarmSettings> = {}): AlarmSettings {
  return {
    userId: USER,
    cityName: "Riyadh",
    countryCode: "SA",
    admin1: null,
    lat: 24.7136,
    lng: 46.6753,
    timezone: "Asia/Riyadh",
    method: "UmmAlQura",
    offsetMinutes: -10,
    vibrationEnabled: true,
    vibrationPower: 50,
    vibrationPattern: "RISE",
    thermalEnabled: true,
    thermalLevel: 0,
    smartWake: false,
    paused: false,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

async function setup(opts: { eightTimezone?: string | null; settings?: Partial<AlarmSettings> } = {}) {
  const store = new MemoryStore();
  const mock = new MockEightSleep();
  const session = await mock.login("demo@example.com", "demo-password");
  store.users.set(USER, { id: USER, email: "u@example.com", locale: "ar", createdAt: "2026-10-01T00:00:00.000Z", lastLoginAt: null });
  store.connections.set(USER, {
    userId: USER,
    eightUserId: session.userId,
    eightTimezone: opts.eightTimezone === undefined ? "Asia/Riyadh" : opts.eightTimezone,
    accessTokenEnc: `enc:${session.accessToken}`,
    refreshTokenEnc: session.refreshToken ? `enc:${session.refreshToken}` : null,
    tokenExpiresAt: new Date(session.expiresAt).toISOString(),
    eightDeviceId: "mock-device-mock-user-1",
    status: "connected",
    consecutiveFailures: 0,
    attentionEmailSentAt: null,
    lastErrorCode: null,
    connectedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  store.settings.set(USER, baseSettings(opts.settings));
  let nowMs = RIYADH_FAJR_OCT24 - 6 * 3_600_000; // ~22:37 the night before
  const notified: string[] = [];
  const events: string[] = [];
  const deps: SyncDeps = {
    store,
    eight: mock,
    decryptToken: async (enc) => enc.replace(/^enc:/, ""),
    encryptToken: async (plain) => `enc:${plain}`,
    now: () => nowMs,
    notifyNeedsAttention: async (_u, code) => void notified.push(code),
    analytics: async (event) => void events.push(event),
  };
  return { store, mock, deps, notified, events, setNow: (ms: number) => (nowMs = ms), getNow: () => nowMs };
}

describe("syncUser — the one-alarm invariant", () => {
  it("creates the alarm on first sync with Fajr+offset formatted in the account zone", async () => {
    const { store, mock, deps } = await setup();
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.result).toBe("created");
    const expectedMs = RIYADH_FAJR_OCT24 - 10 * 60_000;
    expect(out.scheduledForUtc).toBe(new Date(expectedMs).toISOString());
    expect(out.scheduledLocal).toBe(formatTimeInTz(expectedMs, "Asia/Riyadh"));
    expect(out.scheduledLocal).toBe("04:27:00");
    const alarms = [...mock.alarms.values()][0]!;
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ time: "04:27:00", enabled: true, vibration: { powerLevel: 50, pattern: "RISE" }, thermal: { level: 0 }, smart: { lightSleepEnabled: false } });
    expect(store.managed.get(USER)?.eightAlarmId).toBe(alarms[0]!.id);
    expect(store.log.at(-1)).toMatchObject({ result: "created", trigger: "cron" });
  });

  it("is idempotent: a second run performs no API write", async () => {
    const { mock, deps, store } = await setup();
    await syncUser(deps, USER, { trigger: "cron" });
    const callsAfterFirst = { ...mock.calls };
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.result).toBe("skipped");
    expect(mock.calls).toEqual(callsAfterFirst);
    expect([...mock.alarms.values()][0]).toHaveLength(1);
    expect(store.log.map((l) => l.result)).toEqual(["created", "skipped"]);
  });

  it("after the alarm time passes, updates the SAME alarm to the next day (never a second alarm)", async () => {
    const { mock, deps, store, setNow } = await setup();
    await syncUser(deps, USER, { trigger: "cron" });
    const id = store.managed.get(USER)!.eightAlarmId;
    setNow(RIYADH_FAJR_OCT24 + 60 * 60_000); // an hour after today's Fajr
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.result).toBe("updated");
    const alarms = [...mock.alarms.values()][0]!;
    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.id).toBe(id);
    const tomorrow = fajrOn({ year: 2026, month: 10, day: 25 }, { lat: 24.7136, lng: 46.6753, timezone: "Asia/Riyadh", method: "UmmAlQura", offsetMinutes: 0 });
    expect(alarms[0]!.time).toBe(formatTimeInTz(tomorrow - 10 * 60_000, "Asia/Riyadh"));
    expect(store.managed.get(USER)?.eightAlarmId).toBe(id);
    expect(mock.calls.createAlarm).toBe(1);
  });

  it("recreates once when the alarm was deleted in the Eight Sleep app, and stores the new id", async () => {
    const { mock, deps, store, setNow } = await setup();
    await syncUser(deps, USER, { trigger: "cron" });
    const oldId = store.managed.get(USER)!.eightAlarmId;
    mock.deleteAlarmExternally("mock-user-1", oldId);
    setNow(RIYADH_FAJR_OCT24 + 60 * 60_000);
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.result).toBe("recreated");
    const newId = store.managed.get(USER)!.eightAlarmId;
    expect(newId).not.toBe(oldId);
    expect(store.managed.get(USER)!.recreatedCount).toBe(1);
    expect([...mock.alarms.values()][0]).toHaveLength(1);
    // And then it's stable again.
    expect((await syncUser(deps, USER, { trigger: "cron" })).result).toBe("skipped");
    expect(mock.calls.createAlarm).toBe(2);
  });

  it("force (settings change) re-pushes immediately even when the time is unchanged", async () => {
    const { mock, deps, store } = await setup();
    await syncUser(deps, USER, { trigger: "cron" });
    store.settings.set(USER, baseSettings({ offsetMinutes: -10, vibrationPower: 100, updatedAt: "2026-10-20T00:00:00.000Z" }));
    const out = await syncUser(deps, USER, { force: true, trigger: "settings" });
    expect(out.result).toBe("updated");
    expect([...mock.alarms.values()][0]![0]!.vibration).toMatchObject({ powerLevel: 100 });
  });

  it("a settings change that the immediate sync missed is picked up by the next cron run (updatedAt newer than lastPushedAt)", async () => {
    const { deps, store } = await setup();
    await syncUser(deps, USER, { trigger: "cron" });
    const pushedAt = store.managed.get(USER)!.lastPushedAt!;
    store.settings.set(USER, baseSettings({ offsetMinutes: -10, updatedAt: new Date(Date.parse(pushedAt) + 1000).toISOString() }));
    expect((await syncUser(deps, USER, { trigger: "cron" })).result).toBe("updated");
  });

  it("paused: disables the Pod alarm once, then does nothing; resume re-enables with a fresh time", async () => {
    const { mock, deps, store } = await setup();
    await syncUser(deps, USER, { trigger: "cron" });
    store.settings.set(USER, baseSettings({ paused: true }));
    expect((await syncUser(deps, USER, { force: true, trigger: "pause" })).result).toBe("paused");
    expect([...mock.alarms.values()][0]![0]!.enabled).toBe(false);
    const calls = { ...mock.calls };
    expect((await syncUser(deps, USER, { trigger: "cron" })).result).toBe("paused");
    expect(mock.calls).toEqual(calls); // no further API traffic while paused
    store.settings.set(USER, baseSettings({ paused: false }));
    expect((await syncUser(deps, USER, { force: true, trigger: "resume" })).result).toBe("updated");
    expect([...mock.alarms.values()][0]![0]!.enabled).toBe(true);
    expect([...mock.alarms.values()][0]).toHaveLength(1);
  });

  it("formats the alarm time in the Eight Sleep account's zone when it differs from the city", async () => {
    const { deps } = await setup({ eightTimezone: "Europe/London" });
    const out = await syncUser(deps, USER, { trigger: "cron" });
    // 04:27 Riyadh (+3) = 02:27 London (BST, +1)
    expect(out.scheduledLocal).toBe("02:27:00");
  });

  it("falls back to the city zone when the account has no timezone", async () => {
    const { deps } = await setup({ eightTimezone: null });
    expect((await syncUser(deps, USER, { trigger: "cron" })).scheduledLocal).toBe("04:27:00");
  });
});

describe("syncUser — failures", () => {
  it("counts consecutive failures, notifies exactly once at the threshold, and resets on success", async () => {
    const { mock, deps, store, notified } = await setup();
    for (let i = 1; i <= FAILURES_BEFORE_ATTENTION + 1; i++) {
      mock.failNext("any", new EightSleepError("RATE_LIMITED", "429", { status: 429 }));
      const out = await syncUser(deps, USER, { trigger: "cron" });
      expect(out.result).toBe("failed");
      expect(out.errorCode).toBe("RATE_LIMITED");
      expect(store.connections.get(USER)!.consecutiveFailures).toBe(i);
      expect(store.connections.get(USER)!.status).toBe("connected"); // transient: stays connected
    }
    expect(notified).toEqual(["RATE_LIMITED"]); // once, not twice
    const ok = await syncUser(deps, USER, { trigger: "cron" });
    expect(ok.result).toBe("created");
    expect(store.connections.get(USER)!.consecutiveFailures).toBe(0);
    expect(store.connections.get(USER)!.attentionEmailSentAt).toBeNull();
  });

  it("renews a nearly-expired access token with the refresh token before syncing, and persists the new tokens", async () => {
    const { mock, deps, store } = await setup();
    const soon = new Date((deps.now?.() ?? Date.now()) + 30 * 60_000).toISOString(); // 30 min left (< 2 h)
    store.connections.set(USER, { ...store.connections.get(USER)!, tokenExpiresAt: soon });
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.result).toBe("created");
    expect(mock.calls.refresh).toBe(1);
    const conn = store.connections.get(USER)!;
    expect(conn.accessTokenEnc).not.toBe("enc:mock-token-1");
    expect(conn.refreshTokenEnc).toMatch(/^enc:mock-refresh-/);
    expect(Date.parse(conn.tokenExpiresAt!)).toBeGreaterThan(Date.parse(soon));
  });

  it("recovers from an unexpected 401 by refreshing once and retrying", async () => {
    const { mock, deps, store } = await setup();
    mock.expireAccessTokens(); // stored expiry still looks fine, but the server says 401
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.result).toBe("created");
    expect(mock.calls.refresh).toBe(1);
    expect(store.connections.get(USER)!.status).toBe("connected");
  });

  it("expired token and no refresh token → AUTH_FAILED without calling the API", async () => {
    const { mock, deps, store } = await setup();
    store.connections.set(USER, { ...store.connections.get(USER)!, tokenExpiresAt: "2020-01-01T00:00:00.000Z", refreshTokenEnc: null });
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.errorCode).toBe("AUTH_FAILED");
    expect(mock.calls.listAlarms + mock.calls.createAlarm + mock.calls.refresh).toBe(0);
    expect(store.connections.get(USER)!.status).toBe("needs_reconnect");
  });

  it("revoked refresh token (password change) → needs_reconnect immediately, notified once, cron skips the user afterwards", async () => {
    const { mock, deps, store, notified } = await setup();
    mock.revokeAllTokens();
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out).toMatchObject({ result: "failed", errorCode: "AUTH_FAILED" });
    expect(store.connections.get(USER)!.status).toBe("needs_reconnect");
    expect(notified).toEqual(["AUTH_FAILED"]);
    expect((await syncUser(deps, USER, { trigger: "cron" })).result).toBe("skipped");
    expect(notified).toHaveLength(1);
  });

  it("403 subscription → no_subscription status", async () => {
    const { mock, deps, store } = await setup();
    mock.accounts.get("demo@example.com")!.subscription = false;
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.errorCode).toBe("NO_SUBSCRIPTION");
    expect(store.connections.get(USER)!.status).toBe("no_subscription");
  });

  it("a token past its stored expiry is refreshed first, not tried as-is", async () => {
    const { mock, deps, store } = await setup();
    store.connections.set(USER, { ...store.connections.get(USER)!, tokenExpiresAt: "2020-01-01T00:00:00.000Z" });
    const out = await syncUser(deps, USER, { trigger: "cron" });
    expect(out.result).toBe("created");
    expect(mock.calls.refresh).toBe(1);
  });

  it("emits analytics without PII", async () => {
    const { deps, events } = await setup();
    await syncUser(deps, USER, { trigger: "cron" });
    expect(events).toEqual(["alarm_synced"]);
  });
});

describe("removeManagedAlarm (disconnect)", () => {
  it("deletes our alarm from the Pod and forgets it locally; tolerates API failure", async () => {
    const { mock, deps, store } = await setup();
    await syncUser(deps, USER, { trigger: "cron" });
    expect(await removeManagedAlarm(deps, USER)).toBe(true);
    expect([...mock.alarms.values()][0]).toHaveLength(0);
    expect(store.managed.get(USER)).toBeUndefined();

    await syncUser(deps, USER, { trigger: "cron" });
    mock.revokeAllTokens();
    expect(await removeManagedAlarm(deps, USER)).toBe(false);
    expect(store.managed.get(USER)).toBeUndefined(); // local state is cleared regardless
  });
});
