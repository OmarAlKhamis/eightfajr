import { and, desc, eq, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  alarmSettings,
  eightConnections,
  feedback,
  magicLinks,
  managedAlarms,
  syncLog,
  users,
  type AlarmSettings,
  type EightConnection,
  type Feedback,
  type ManagedAlarm,
  type SyncLogEntry,
  type User,
} from "@shared/schema";
import type { Db } from "./db";
import { nowIso } from "./db";
import { newId } from "./crypto";

// All D1 access goes through here. server/sync.ts depends only on the narrow
// `SyncStore` slice so it can be unit-tested with an in-memory implementation.

export interface DueUser {
  userId: string;
}

export interface SyncStore {
  getConnection(userId: string): Promise<EightConnection | null>;
  updateConnection(userId: string, patch: Partial<Omit<EightConnection, "userId">>): Promise<void>;
  getSettings(userId: string): Promise<AlarmSettings | null>;
  getManaged(userId: string): Promise<ManagedAlarm | null>;
  upsertManaged(row: ManagedAlarm): Promise<void>;
  deleteManaged(userId: string): Promise<void>;
  insertSync(entry: Omit<SyncLogEntry, "id">): Promise<void>;
  getUser(id: string): Promise<User | null>;
}

export class Storage implements SyncStore {
  constructor(private readonly db: Db) {}

  // ---- users -------------------------------------------------------------
  async getUser(id: string): Promise<User | null> {
    const [u] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return u ?? null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const [u] = await this.db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return u ?? null;
  }

  async getOrCreateUser(email: string, locale: "ar" | "en"): Promise<{ user: User; created: boolean }> {
    const existing = await this.getUserByEmail(email);
    if (existing) return { user: existing, created: false };
    const user: User = { id: newId(), email: email.toLowerCase(), locale, createdAt: nowIso(), lastLoginAt: null };
    await this.db.insert(users).values(user);
    return { user, created: true };
  }

  async touchLogin(id: string): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, id));
  }

  async setLocale(id: string, locale: "ar" | "en"): Promise<void> {
    await this.db.update(users).set({ locale }).where(eq(users.id, id));
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, id));
  }

  // ---- magic links -------------------------------------------------------
  async createMagicLink(email: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.db.insert(magicLinks).values({ id: newId(), email: email.toLowerCase(), tokenHash, expiresAt, usedAt: null, createdAt: nowIso() });
  }

  async countRecentMagicLinks(email: string, sinceIso: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(magicLinks)
      .where(and(eq(magicLinks.email, email.toLowerCase()), gte(magicLinks.createdAt, sinceIso)));
    return Number(r?.n ?? 0);
  }

  /** Returns the link if valid (unused, unexpired) and marks it used atomically-enough for D1. */
  async consumeMagicLink(tokenHash: string): Promise<{ email: string } | null> {
    const now = nowIso();
    const [link] = await this.db
      .select()
      .from(magicLinks)
      .where(and(eq(magicLinks.tokenHash, tokenHash), isNull(magicLinks.usedAt), gt(magicLinks.expiresAt, now)))
      .limit(1);
    if (!link) return null;
    const res = await this.db
      .update(magicLinks)
      .set({ usedAt: now })
      .where(and(eq(magicLinks.id, link.id), isNull(magicLinks.usedAt)))
      .returning({ id: magicLinks.id });
    if (res.length === 0) return null; // lost a race
    return { email: link.email };
  }

  async purgeExpiredMagicLinks(beforeIso: string): Promise<void> {
    await this.db.delete(magicLinks).where(lt(magicLinks.expiresAt, beforeIso));
  }

  // ---- eight connections -------------------------------------------------
  async getConnection(userId: string): Promise<EightConnection | null> {
    const [c] = await this.db.select().from(eightConnections).where(eq(eightConnections.userId, userId)).limit(1);
    return c ?? null;
  }

  async upsertConnection(row: EightConnection): Promise<void> {
    await this.db
      .insert(eightConnections)
      .values(row)
      .onConflictDoUpdate({ target: eightConnections.userId, set: { ...row } });
  }

  async updateConnection(userId: string, patch: Partial<Omit<EightConnection, "userId">>): Promise<void> {
    await this.db
      .update(eightConnections)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(eightConnections.userId, userId));
  }

  async deleteConnection(userId: string): Promise<void> {
    await this.db.delete(eightConnections).where(eq(eightConnections.userId, userId));
  }

  // ---- settings ----------------------------------------------------------
  async getSettings(userId: string): Promise<AlarmSettings | null> {
    const [s] = await this.db.select().from(alarmSettings).where(eq(alarmSettings.userId, userId)).limit(1);
    return s ?? null;
  }

  async upsertSettings(row: AlarmSettings): Promise<void> {
    await this.db
      .insert(alarmSettings)
      .values(row)
      .onConflictDoUpdate({ target: alarmSettings.userId, set: { ...row } });
  }

  async setPaused(userId: string, paused: boolean): Promise<void> {
    await this.db.update(alarmSettings).set({ paused, updatedAt: nowIso() }).where(eq(alarmSettings.userId, userId));
  }

  async deleteSettings(userId: string): Promise<void> {
    await this.db.delete(alarmSettings).where(eq(alarmSettings.userId, userId));
  }

  // ---- managed alarm -----------------------------------------------------
  async getManaged(userId: string): Promise<ManagedAlarm | null> {
    const [m] = await this.db.select().from(managedAlarms).where(eq(managedAlarms.userId, userId)).limit(1);
    return m ?? null;
  }

  async upsertManaged(row: ManagedAlarm): Promise<void> {
    await this.db
      .insert(managedAlarms)
      .values(row)
      .onConflictDoUpdate({ target: managedAlarms.userId, set: { ...row } });
  }

  async deleteManaged(userId: string): Promise<void> {
    await this.db.delete(managedAlarms).where(eq(managedAlarms.userId, userId));
  }

  // ---- sync log ----------------------------------------------------------
  async insertSync(entry: Omit<SyncLogEntry, "id">): Promise<void> {
    await this.db.insert(syncLog).values({ id: newId(), ...entry });
  }

  async lastSync(userId: string): Promise<SyncLogEntry | null> {
    const [e] = await this.db.select().from(syncLog).where(eq(syncLog.userId, userId)).orderBy(desc(syncLog.startedAt)).limit(1);
    return e ?? null;
  }

  async anonymizeSyncLog(userId: string): Promise<void> {
    await this.db.update(syncLog).set({ userId: null }).where(eq(syncLog.userId, userId));
  }

  /**
   * Users the hourly job must look at: connected, not paused, and either never
   * pushed, pushed for an instant that has passed, mid-failure (retry hourly),
   * or whose settings changed after the last push (immediate sync failed).
   */
  async listDueUsers(nowIsoStr: string): Promise<DueUser[]> {
    const rows = await this.db
      .select({ userId: eightConnections.userId })
      .from(eightConnections)
      .innerJoin(alarmSettings, eq(alarmSettings.userId, eightConnections.userId))
      .leftJoin(managedAlarms, eq(managedAlarms.userId, eightConnections.userId))
      .where(
        and(
          eq(eightConnections.status, "connected"),
          eq(alarmSettings.paused, false),
          or(
            isNull(managedAlarms.userId),
            isNull(managedAlarms.scheduledForUtc),
            lte(managedAlarms.scheduledForUtc, nowIsoStr),
            eq(managedAlarms.pushedEnabled, false),
            gt(eightConnections.consecutiveFailures, 0),
            gt(alarmSettings.updatedAt, sql`coalesce(${managedAlarms.lastPushedAt}, '')`),
          ),
        ),
      )
      .orderBy(eightConnections.userId);
    return rows;
  }

  // ---- feedback ----------------------------------------------------------
  async insertFeedback(row: Omit<Feedback, "id">): Promise<void> {
    await this.db.insert(feedback).values({ id: newId(), ...row });
  }

  // ---- admin -------------------------------------------------------------
  async adminStats(sinceIso: string) {
    const [usersCount] = await this.db.select({ n: sql<number>`count(*)` }).from(users);
    const [connected] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(eightConnections)
      .where(eq(eightConnections.status, "connected"));
    const [attention] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(eightConnections)
      .where(or(eq(eightConnections.status, "needs_reconnect"), eq(eightConnections.status, "no_subscription")));
    const [paused] = await this.db.select({ n: sql<number>`count(*)` }).from(alarmSettings).where(eq(alarmSettings.paused, true));
    const byResult = await this.db
      .select({ result: syncLog.result, n: sql<number>`count(*)` })
      .from(syncLog)
      .where(gte(syncLog.startedAt, sinceIso))
      .groupBy(syncLog.result);
    const perDay = await this.db
      .select({ day: sql<string>`substr(${syncLog.startedAt}, 1, 10)`, result: syncLog.result, n: sql<number>`count(*)` })
      .from(syncLog)
      .where(gte(syncLog.startedAt, sinceIso))
      .groupBy(sql`substr(${syncLog.startedAt}, 1, 10)`, syncLog.result)
      .orderBy(sql`substr(${syncLog.startedAt}, 1, 10)`);
    const countries = await this.db
      .select({ key: alarmSettings.countryCode, n: sql<number>`count(*)` })
      .from(alarmSettings)
      .groupBy(alarmSettings.countryCode)
      .orderBy(desc(sql`count(*)`))
      .limit(10);
    const methods = await this.db
      .select({ key: alarmSettings.method, n: sql<number>`count(*)` })
      .from(alarmSettings)
      .groupBy(alarmSettings.method)
      .orderBy(desc(sql`count(*)`))
      .limit(12);
    const errors = await this.db
      .select({ key: syncLog.errorCode, n: sql<number>`count(*)` })
      .from(syncLog)
      .where(and(gte(syncLog.startedAt, sinceIso), eq(syncLog.result, "failed")))
      .groupBy(syncLog.errorCode)
      .orderBy(desc(sql`count(*)`));
    const recentFeedback = await this.db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(50);
    const [fbUp] = await this.db.select({ n: sql<number>`count(*)` }).from(feedback).where(eq(feedback.rating, "up"));
    const [fbDown] = await this.db.select({ n: sql<number>`count(*)` }).from(feedback).where(eq(feedback.rating, "down"));
    return {
      users: Number(usersCount?.n ?? 0),
      connected: Number(connected?.n ?? 0),
      needsAttention: Number(attention?.n ?? 0),
      paused: Number(paused?.n ?? 0),
      syncsByResult: byResult.map((r) => ({ result: r.result, n: Number(r.n) })),
      syncsPerDay: perDay.map((r) => ({ day: r.day, result: r.result, n: Number(r.n) })),
      topCountries: countries.map((r) => ({ key: r.key, n: Number(r.n) })),
      topMethods: methods.map((r) => ({ key: r.key, n: Number(r.n) })),
      errorCodes: errors.map((r) => ({ key: r.key ?? "UNKNOWN", n: Number(r.n) })),
      feedback: { up: Number(fbUp?.n ?? 0), down: Number(fbDown?.n ?? 0), recent: recentFeedback },
    };
  }
}
