import { EightSleepError } from "./errors";
import type { EightAlarm, EightAlarmInput, EightSession, EightSleepApi, EightUser } from "./types";

// In-memory fake of the Eight Sleep API. Used by unit tests, the smoke test and
// local dev (EIGHT_MOCK=1). Deterministic, inspectable, and scriptable: tests
// can delete an alarm "from the Eight Sleep app", inject a 429, or revoke a token.

export interface MockAccount {
  email: string;
  password: string;
  userId: string;
  timezone: string | null;
  subscription: boolean;
}

export interface MockOptions {
  accounts?: MockAccount[];
  tokenTtlSeconds?: number;
  now?: () => number;
}

export interface MockCallCounts {
  login: number;
  getMe: number;
  listAlarms: number;
  createAlarm: number;
  updateAlarm: number;
  deleteAlarm: number;
}

export class MockEightSleep implements EightSleepApi {
  readonly accounts = new Map<string, MockAccount>(); // by email (lower)
  readonly alarms = new Map<string, EightAlarm[]>(); // by userId
  readonly tokens = new Map<string, { userId: string; expiresAt: number }>();
  readonly calls: MockCallCounts = { login: 0, getMe: 0, listAlarms: 0, createAlarm: 0, updateAlarm: 0, deleteAlarm: 0 };
  /** Errors to throw on the next matching call(s), FIFO. */
  private readonly failQueue: { op: keyof MockCallCounts | "any"; error: EightSleepError }[] = [];
  private seq = 0;
  private readonly tokenTtl: number;
  private readonly now: () => number;

  constructor(opts: MockOptions = {}) {
    this.tokenTtl = (opts.tokenTtlSeconds ?? 3600) * 1000;
    this.now = opts.now ?? Date.now;
    for (const a of opts.accounts ?? [
      { email: "demo@example.com", password: "demo-password", userId: "mock-user-1", timezone: "Asia/Riyadh", subscription: true },
    ]) {
      this.addAccount(a);
    }
  }

  addAccount(a: MockAccount): void {
    this.accounts.set(a.email.toLowerCase(), a);
    if (!this.alarms.has(a.userId)) this.alarms.set(a.userId, []);
  }

  /** Make the next call of `op` (or any call) fail with `error`. */
  failNext(op: keyof MockCallCounts | "any", error: EightSleepError): void {
    this.failQueue.push({ op, error });
  }

  /** Simulate the user deleting the alarm in the Eight Sleep app. */
  deleteAlarmExternally(userId: string, alarmId: string): boolean {
    const list = this.alarms.get(userId) ?? [];
    const before = list.length;
    this.alarms.set(
      userId,
      list.filter((a) => a.id !== alarmId),
    );
    return list.length !== before;
  }

  /** Simulate token revocation (user changed password, etc.). */
  revokeAllTokens(): void {
    this.tokens.clear();
  }

  private maybeFail(op: keyof MockCallCounts): void {
    const i = this.failQueue.findIndex((f) => f.op === op || f.op === "any");
    if (i >= 0) {
      const [f] = this.failQueue.splice(i, 1);
      throw f!.error;
    }
  }

  private check(session: EightSession): MockAccount {
    const t = this.tokens.get(session.accessToken);
    if (!t || t.expiresAt <= this.now()) throw new EightSleepError("AUTH_FAILED", "mock: token invalid", { status: 401 });
    const acc = [...this.accounts.values()].find((a) => a.userId === t.userId);
    if (!acc) throw new EightSleepError("AUTH_FAILED", "mock: unknown user", { status: 401 });
    return acc;
  }

  private requireSubscription(acc: MockAccount): void {
    if (!acc.subscription) {
      throw new EightSleepError("NO_SUBSCRIPTION", "mock: subscription required", { status: 403 });
    }
  }

  async login(email: string, password: string): Promise<EightSession> {
    this.calls.login++;
    this.maybeFail("login");
    const acc = this.accounts.get(email.toLowerCase());
    if (!acc || acc.password !== password) {
      throw new EightSleepError("INVALID_CREDENTIALS", "mock: bad credentials", { status: 401 });
    }
    const accessToken = `mock-token-${++this.seq}`;
    const expiresAt = this.now() + this.tokenTtl;
    this.tokens.set(accessToken, { userId: acc.userId, expiresAt });
    return { accessToken, userId: acc.userId, expiresAt };
  }

  async getMe(session: EightSession): Promise<EightUser> {
    this.calls.getMe++;
    this.maybeFail("getMe");
    const acc = this.check(session);
    return { userId: acc.userId, timezone: acc.timezone, email: acc.email, firstName: "Demo" };
  }

  async listAlarms(session: EightSession): Promise<EightAlarm[]> {
    this.calls.listAlarms++;
    this.maybeFail("listAlarms");
    const acc = this.check(session);
    this.requireSubscription(acc);
    return structuredClone(this.alarms.get(acc.userId) ?? []);
  }

  async createAlarm(session: EightSession, input: EightAlarmInput): Promise<EightAlarm> {
    this.calls.createAlarm++;
    this.maybeFail("createAlarm");
    const acc = this.check(session);
    this.requireSubscription(acc);
    const alarm: EightAlarm = {
      id: `mock-alarm-${++this.seq}`,
      enabled: input.enabled,
      time: input.time,
      repeat: { enabled: false, weekDays: {} },
      vibration: { enabled: input.vibrationEnabled, powerLevel: input.vibrationPower, pattern: "RISE" },
      thermal: { enabled: input.thermalEnabled, level: input.thermalLevel },
      snoozing: false,
      nextTimestamp: new Date(this.now() + 3_600_000).toISOString(),
    };
    this.alarms.get(acc.userId)!.push(alarm);
    return structuredClone(alarm);
  }

  async updateAlarm(session: EightSession, existing: EightAlarm, patch: Partial<EightAlarmInput>): Promise<EightAlarm> {
    this.calls.updateAlarm++;
    this.maybeFail("updateAlarm");
    const acc = this.check(session);
    this.requireSubscription(acc);
    const list = this.alarms.get(acc.userId)!;
    const idx = list.findIndex((a) => a.id === existing.id);
    if (idx < 0) throw new EightSleepError("NOT_FOUND", "mock: alarm not found", { status: 404 });
    const cur = list[idx]!;
    const next: EightAlarm = {
      ...cur,
      time: patch.time ?? cur.time,
      enabled: patch.enabled ?? cur.enabled,
      vibration: {
        ...(cur.vibration ?? { pattern: "RISE", enabled: true }),
        enabled: patch.vibrationEnabled ?? cur.vibration?.enabled ?? true,
        powerLevel: patch.vibrationPower ?? cur.vibration?.powerLevel ?? 50,
      },
      thermal: {
        ...(cur.thermal ?? { enabled: true }),
        enabled: patch.thermalEnabled ?? cur.thermal?.enabled ?? true,
        level: patch.thermalLevel ?? cur.thermal?.level ?? 0,
      },
    };
    list[idx] = next;
    return structuredClone(next);
  }

  async deleteAlarm(session: EightSession, alarmId: string): Promise<void> {
    this.calls.deleteAlarm++;
    this.maybeFail("deleteAlarm");
    const acc = this.check(session);
    this.deleteAlarmExternally(acc.userId, alarmId);
  }
}
