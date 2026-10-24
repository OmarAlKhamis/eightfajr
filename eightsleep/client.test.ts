import { describe, expect, it, vi } from "vitest";
import { APP_API_URL, AUTH_URL, CLIENT_API_URL, createEightSleepClient } from "./client";
import { EightSleepError, errorFromStatus } from "./errors";
import { MockEightSleep } from "./mock";
import { SerialQueue, withRetry } from "./queue";
import type { EightAlarm, EightSession } from "./types";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

function fakeFetch(handler: (call: Call) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(url),
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const noSleep = { sleep: async () => {}, random: () => 0.5 };
const session: EightSession = { accessToken: "tok", userId: "u1", expiresAt: Date.now() + 3600_000 };

describe("createEightSleepClient", () => {
  it("logs in with the password grant, JSON body and okhttp user-agent, and never keeps the password", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { access_token: "abc", expires_in: 7200, userId: "u1" } }));
    const api = createEightSleepClient({ clientId: "cid", clientSecret: "sec", fetch, retry: noSleep });
    const before = Date.now();
    const s = await api.login("me@example.com", "pw");
    expect(calls[0]!.url).toBe(AUTH_URL);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ client_id: "cid", client_secret: "sec", grant_type: "password", username: "me@example.com", password: "pw" });
    expect(calls[0]!.headers["user-agent"]).toBe("okhttp/4.9.3");
    expect(calls[0]!.headers["content-type"]).toMatch(/application\/json/);
    expect(s.accessToken).toBe("abc");
    expect(s.userId).toBe("u1");
    expect(s.expiresAt).toBeGreaterThanOrEqual(before + 7200_000);
    expect(JSON.stringify(s)).not.toContain("pw");
  });

  it("maps a rejected login to INVALID_CREDENTIALS without retrying", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 401, body: { error: "invalid_grant" } }));
    const api = createEightSleepClient({ clientId: "cid", clientSecret: "sec", fetch, retry: noSleep });
    await expect(api.login("a@b.c", "x")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(calls).toHaveLength(1);
  });

  it("sends the bearer token and reads timezone from /users/me", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { user: { userId: "u1", timezone: "Asia/Riyadh", email: "x@y.z" } } }));
    const api = createEightSleepClient({ clientId: "c", clientSecret: "s", fetch, retry: noSleep });
    const me = await api.getMe(session);
    expect(calls[0]!.url).toBe(`${CLIENT_API_URL}/users/me`);
    expect(calls[0]!.headers.authorization).toBe("Bearer tok");
    expect(me).toMatchObject({ userId: "u1", timezone: "Asia/Riyadh" });
  });

  it("lists alarms from v2 and creates one-off alarms on v1 with pyEight's payload", async () => {
    const { fetch, calls } = fakeFetch((c) => {
      if (c.method === "GET") return { status: 200, body: { alarms: [{ id: "a1", enabled: true, time: "05:00:00" }], recommendedAlarm: null } };
      return { status: 200, body: { alarm: { id: "a2", enabled: true, time: c.body && (c.body as { time: string }).time } } };
    });
    const api = createEightSleepClient({ clientId: "c", clientSecret: "s", fetch, retry: noSleep });
    const list = await api.listAlarms(session);
    expect(calls[0]!.url).toBe(`${APP_API_URL}/v2/users/u1/alarms`);
    expect(list.map((a) => a.id)).toEqual(["a1"]);

    const created = await api.createAlarm(session, {
      time: "04:37:00",
      enabled: true,
      vibrationEnabled: true,
      vibrationPower: 50,
      thermalEnabled: true,
      thermalLevel: 0,
    });
    expect(calls[1]!.url).toBe(`${APP_API_URL}/v1/users/u1/alarms`);
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.body).toEqual({
      time: "04:37:00",
      enabled: true,
      vibration: { enabled: true, powerLevel: 50, pattern: "RISE" },
      thermal: { enabled: true, level: 0 },
    });
    expect(created.id).toBe("a2");
  });

  it("PUTs the full alarm minus server-computed fields when updating", async () => {
    const { fetch, calls } = fakeFetch((c) => ({ status: 200, body: { alarm: { ...(c.body as object), id: "a1" } } }));
    const api = createEightSleepClient({ clientId: "c", clientSecret: "s", fetch, retry: noSleep });
    const existing: EightAlarm = {
      id: "a1",
      enabled: false,
      time: "05:00:00",
      repeat: { enabled: false, weekDays: {} },
      thermal: { enabled: true, level: 10 },
      vibration: { enabled: true, powerLevel: 50, pattern: "RISE" },
      snoozing: false,
      snoozedUntil: null,
      nextTimestamp: "2026-10-25T01:37:00Z",
      startTimestamp: "x",
      endTimestamp: "y",
      dismissedUntil: null,
      skippedUntil: null,
      skipNext: false,
      audio: { enabled: false, level: 30 },
      smart: { lightSleepEnabled: false, sleepCapEnabled: false, sleepCapMinutes: 480 },
      someFutureField: "keep-me",
    };
    const updated = await api.updateAlarm(session, existing, { time: "04:37:00", enabled: true, vibrationPower: 100 });
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe(`${APP_API_URL}/v1/users/u1/alarms/a1`);
    const body = calls[0]!.body as Record<string, unknown>;
    for (const f of ["nextTimestamp", "startTimestamp", "endTimestamp", "dismissedUntil", "snoozedUntil", "skippedUntil"]) expect(body).not.toHaveProperty(f);
    expect(body).toMatchObject({
      id: "a1",
      time: "04:37:00",
      enabled: true,
      skipNext: false,
      audio: { enabled: false, level: 30 },
      smart: { sleepCapMinutes: 480 },
      someFutureField: "keep-me",
      vibration: { powerLevel: 100, pattern: "RISE" },
    });
    expect(updated.time).toBe("04:37:00");
  });

  it("treats DELETE 404 as success (already gone)", async () => {
    const { fetch } = fakeFetch(() => ({ status: 404, body: { message: "not found" } }));
    const api = createEightSleepClient({ clientId: "c", clientSecret: "s", fetch, retry: noSleep });
    await expect(api.deleteAlarm(session, "a1")).resolves.toBeUndefined();
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(() => (++n < 3 ? { status: 429, body: {}, headers: { "retry-after": "1" } } : { status: 200, body: { alarms: [] } }));
    const sleeps: number[] = [];
    const api = createEightSleepClient({
      clientId: "c",
      clientSecret: "s",
      fetch,
      retry: { sleep: async (ms) => void sleeps.push(ms), random: () => 0.5, baseMs: 1000 },
    });
    await expect(api.listAlarms(session)).resolves.toEqual([]);
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    for (const s of sleeps) expect(s).toBeGreaterThanOrEqual(1000); // Retry-After floor
  });

  it("gives up after the configured attempts and surfaces RATE_LIMITED", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 429, body: {} }));
    const api = createEightSleepClient({ clientId: "c", clientSecret: "s", fetch, retry: { ...noSleep, attempts: 3 } });
    await expect(api.listAlarms(session)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls).toHaveLength(3);
  });

  it("does not retry 401 and maps it to AUTH_FAILED; 403 with subscription text → NO_SUBSCRIPTION", async () => {
    const a = fakeFetch(() => ({ status: 401, body: {} }));
    const api = createEightSleepClient({ clientId: "c", clientSecret: "s", fetch: a.fetch, retry: noSleep });
    await expect(api.listAlarms(session)).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(a.calls).toHaveLength(1);
    expect(errorFromStatus(403, '{"message":"Active subscription required"}').code).toBe("NO_SUBSCRIPTION");
    expect(errorFromStatus(403, "nope").code).toBe("FORBIDDEN");
    expect(errorFromStatus(503, "").retryable).toBe(true);
  });

  it("maps fetch failures to NETWORK (retryable)", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const api = createEightSleepClient({ clientId: "c", clientSecret: "s", fetch: failing, retry: { ...noSleep, attempts: 2 } });
    await expect(api.listAlarms(session)).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("withRetry / SerialQueue", () => {
  it("uses full jitter capped by maxMs", async () => {
    const delays: number[] = [];
    let n = 0;
    await withRetry(
      async () => {
        if (++n < 4) throw new EightSleepError("SERVER_ERROR", "x", { status: 500 });
        return "ok";
      },
      { attempts: 4, baseMs: 1000, maxMs: 2500, random: () => 1, sleep: async (ms) => void delays.push(ms) },
    );
    expect(delays).toEqual([1000, 2000, 2500]);
  });

  it("does not retry non-retryable errors", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new EightSleepError("NOT_FOUND", "x", { status: 404 });
        },
        { attempts: 5, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(n).toBe(1);
  });

  it("runs jobs one at a time, in order, with a minimum gap", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const q = new SerialQueue(300, 0, async (ms) => void ((t += ms), sleeps.push(ms)), () => t, () => 0);
    const order: string[] = [];
    const p1 = q.run(async () => void order.push("a"));
    const p2 = q.run(async () => {
      throw new Error("boom");
    });
    const p3 = q.run(async () => void order.push("c"));
    await p1;
    await expect(p2).rejects.toThrow("boom");
    await p3;
    expect(order).toEqual(["a", "c"]);
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    for (const s of sleeps) expect(s).toBe(300);
  });
});

describe("MockEightSleep", () => {
  it("behaves like the real thing for the happy path and scripted failures", async () => {
    const mock = new MockEightSleep();
    const s = await mock.login("demo@example.com", "demo-password");
    expect((await mock.getMe(s)).timezone).toBe("Asia/Riyadh");
    const a = await mock.createAlarm(s, { time: "04:30:00", enabled: true, vibrationEnabled: true, vibrationPower: 50, thermalEnabled: true, thermalLevel: 0 });
    expect((await mock.listAlarms(s)).map((x) => x.id)).toEqual([a.id]);
    const u = await mock.updateAlarm(s, a, { time: "04:31:00" });
    expect(u.time).toBe("04:31:00");
    mock.failNext("listAlarms", new EightSleepError("RATE_LIMITED", "x", { status: 429 }));
    await expect(mock.listAlarms(s)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(mock.listAlarms(s)).resolves.toHaveLength(1);
    mock.deleteAlarmExternally(s.userId, a.id);
    await expect(mock.updateAlarm(s, a, { time: "04:32:00" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    mock.revokeAllTokens();
    await expect(mock.listAlarms(s)).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(mock.login("demo@example.com", "wrong")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(mock.calls.createAlarm).toBe(1);
    vi.restoreAllMocks();
  });
});
