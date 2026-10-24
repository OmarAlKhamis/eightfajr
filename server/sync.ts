import {
  codeOf,
  EightSleepError,
  isEightSleepError,
  isSessionExpired,
  type EightAlarmInput,
  type EightErrorCode,
  type EightSession,
  type EightSleepApi,
} from "@eightsleep/index";
import type { AlarmSettings, EightConnection, ManagedAlarm, SyncLogEntry } from "@shared/schema";
import { formatTimeInTz, nextAlarmAfter, type FajrSettings } from "@shared/fajr";
import { isMethodKey, offsetBucket } from "@shared/methods";
import type { SyncStore } from "./storage";

// The ONE-alarm invariant lives here. `syncUser` is idempotent: given the same
// inputs it performs no API write the second time ("skipped").

export type SyncTrigger = SyncLogEntry["trigger"];
export type SyncResult = SyncLogEntry["result"];

export interface SyncDeps {
  store: SyncStore;
  eight: EightSleepApi;
  decryptToken: (enc: string) => Promise<string>;
  encryptToken: (plain: string) => Promise<string>;
  now?: () => number;
  /** Called once when a user needs to reconnect (3 failures, or a definitive auth/subscription error). */
  notifyNeedsAttention?: (userId: string, code: EightErrorCode) => Promise<void>;
  analytics?: (event: "alarm_synced" | "sync_failed", userId: string, props: Record<string, string | number>) => Promise<void>;
}

export interface SyncOutcome {
  result: SyncResult;
  errorCode?: EightErrorCode;
  message?: string;
  scheduledForUtc?: string;
  scheduledLocal?: string;
}

export const FAILURES_BEFORE_ATTENTION = 3;

function toFajrSettings(s: AlarmSettings): FajrSettings {
  if (!isMethodKey(s.method)) throw new Error(`Unknown method ${s.method}`);
  return { lat: s.lat, lng: s.lng, timezone: s.timezone, method: s.method, offsetMinutes: s.offsetMinutes };
}

function alarmInput(s: AlarmSettings, time: string, enabled: boolean): EightAlarmInput {
  return {
    time,
    enabled,
    vibrationEnabled: s.vibrationEnabled,
    vibrationPower: s.vibrationPower,
    thermalEnabled: s.thermalEnabled,
    thermalLevel: s.thermalLevel,
  };
}

async function sessionFor(deps: SyncDeps, conn: EightConnection): Promise<EightSession> {
  const accessToken = await deps.decryptToken(conn.accessTokenEnc);
  const refreshToken = conn.refreshTokenEnc ? await deps.decryptToken(conn.refreshTokenEnc) : null;
  const expiresAt = conn.tokenExpiresAt ? Date.parse(conn.tokenExpiresAt) : Number.MAX_SAFE_INTEGER;
  return { accessToken, userId: conn.eightUserId, expiresAt, refreshToken };
}

// Access tokens live ≈20 h and we run hourly, so renew whenever less than this remains.
export const REFRESH_AHEAD_MS = 2 * 60 * 60_000;

/** Decrypts the stored session and renews it with the refresh token when it is about to expire. */
export async function ensureSession(deps: SyncDeps, conn: EightConnection, nowMs: number): Promise<EightSession> {
  let session = await sessionFor(deps, conn);
  if (isSessionExpired(session, nowMs, REFRESH_AHEAD_MS)) {
    if (!session.refreshToken) {
      throw new EightSleepError("AUTH_FAILED", "Access token expired and no refresh token stored");
    }
    session = await deps.eight.refresh(session); // throws AUTH_FAILED when the refresh token is dead
    await persistSession(deps, conn.userId, session);
  }
  return session;
}

export async function persistSession(deps: SyncDeps, userId: string, session: EightSession): Promise<void> {
  await deps.store.updateConnection(userId, {
    accessTokenEnc: await deps.encryptToken(session.accessToken),
    refreshTokenEnc: session.refreshToken ? await deps.encryptToken(session.refreshToken) : null,
    tokenExpiresAt: new Date(session.expiresAt).toISOString(),
  });
}

/**
 * Runs an API call; on a 401 tries ONE refresh and retries, so a token revoked
 * early still recovers without bothering the user when the refresh token works.
 */
async function withFreshSession<T>(
  deps: SyncDeps,
  conn: EightConnection,
  session: EightSession,
  fn: (s: EightSession) => Promise<T>,
): Promise<{ result: T; session: EightSession }> {
  try {
    return { result: await fn(session), session };
  } catch (e) {
    if (!(isEightSleepError(e) && e.code === "AUTH_FAILED") || !session.refreshToken) throw e;
    const renewed = await deps.eight.refresh(session);
    await persistSession(deps, conn.userId, renewed);
    return { result: await fn(renewed), session: renewed };
  }
}

export async function syncUser(deps: SyncDeps, userId: string, opts: { force?: boolean; trigger: SyncTrigger }): Promise<SyncOutcome> {
  const now = deps.now ?? Date.now;
  const startedMs = now();
  const startedAt = new Date(startedMs).toISOString();

  const log = async (outcome: SyncOutcome) => {
    await deps.store.insertSync({
      userId,
      startedAt,
      trigger: opts.trigger,
      result: outcome.result,
      errorCode: outcome.errorCode ?? null,
      message: outcome.message ?? null,
      durationMs: now() - startedMs,
    });
    return outcome;
  };

  const conn = await deps.store.getConnection(userId);
  const settings = await deps.store.getSettings(userId);
  if (!conn) return log({ result: "skipped", message: "not connected" });
  if (!settings) return log({ result: "skipped", message: "no settings" });
  if (conn.status !== "connected" && !opts.force) return log({ result: "skipped", message: `status ${conn.status}` });

  const managed = await deps.store.getManaged(userId);

  try {
    // Renews with the refresh token when needed; throws AUTH_FAILED when it can't.
    const session = await ensureSession(deps, conn, startedMs);

    // ---- paused: make sure the Pod alarm is off, once --------------------
    if (settings.paused) {
      if (managed && managed.pushedEnabled) {
        await withFreshSession(deps, conn, session, async (s) => {
          const alarms = await deps.eight.listAlarms(s);
          const existing = alarms.find((a) => a.id === managed.eightAlarmId);
          if (existing && existing.enabled) await deps.eight.updateAlarm(s, existing, { enabled: false });
        });
        await deps.store.upsertManaged({ ...managed, pushedEnabled: false, lastPushedAt: startedAt });
      }
      await markHealthy(deps, conn);
      return log({ result: "paused" });
    }

    // ---- compute the next alarm --------------------------------------------
    const next = nextAlarmAfter(startedMs, toFajrSettings(settings));
    const scheduledForUtc = new Date(next.alarmMs).toISOString();
    const tz = conn.eightTimezone ?? settings.timezone;
    const scheduledLocal = formatTimeInTz(next.alarmMs, tz);

    const unchanged =
      managed &&
      managed.pushedEnabled &&
      managed.scheduledForUtc === scheduledForUtc &&
      managed.scheduledLocal === scheduledLocal &&
      (managed.lastPushedAt ?? "") >= settings.updatedAt;
    if (!opts.force && unchanged) {
      await markHealthy(deps, conn);
      return log({ result: "skipped", message: "already scheduled", scheduledForUtc, scheduledLocal });
    }

    const input = alarmInput(settings, scheduledLocal, true);
    const recreatedBefore = managed?.recreatedCount ?? 0;

    const { result: pushed } = await withFreshSession(deps, conn, session, async (s): Promise<{ result: SyncResult; alarmId: string }> => {
      if (managed) {
        const alarms = await deps.eight.listAlarms(s);
        const existing = alarms.find((a) => a.id === managed.eightAlarmId);
        if (existing) {
          await deps.eight.updateAlarm(s, existing, input);
          return { result: "updated", alarmId: existing.id };
        }
        // Deleted in the Eight Sleep app: recreate exactly once and remember the new id.
        const created = await deps.eight.createAlarm(s, input);
        return { result: "recreated", alarmId: created.id };
      }
      const created = await deps.eight.createAlarm(s, input);
      return { result: "created", alarmId: created.id };
    });
    const { result, alarmId } = pushed;
    const recreatedCount = result === "recreated" ? recreatedBefore + 1 : recreatedBefore;

    await deps.store.upsertManaged({
      userId,
      eightAlarmId: alarmId,
      scheduledForUtc,
      scheduledLocal,
      pushedEnabled: true,
      recreatedCount,
      lastPushedAt: new Date(now()).toISOString(),
    });
    await markHealthy(deps, conn);
    await deps.analytics?.("alarm_synced", userId, {
      result,
      country: settings.countryCode,
      method: settings.method,
      offset_bucket: offsetBucket(settings.offsetMinutes),
      trigger: opts.trigger,
    });
    return log({ result, scheduledForUtc, scheduledLocal });
  } catch (e) {
    const code = codeOf(e);
    const message = e instanceof Error ? e.message : String(e);
    const failures = conn.consecutiveFailures + 1;
    const definitive = code === "AUTH_FAILED" || code === "NO_SUBSCRIPTION" || code === "INVALID_CREDENTIALS";
    const status: EightConnection["status"] =
      code === "NO_SUBSCRIPTION" ? "no_subscription" : code === "AUTH_FAILED" || code === "INVALID_CREDENTIALS" ? "needs_reconnect" : conn.status;

    const patch: Partial<Omit<EightConnection, "userId">> = { consecutiveFailures: failures, lastErrorCode: code, status };
    const shouldNotify = !conn.attentionEmailSentAt && (failures >= FAILURES_BEFORE_ATTENTION || definitive);
    if (shouldNotify) patch.attentionEmailSentAt = new Date(now()).toISOString();
    await deps.store.updateConnection(userId, patch);
    if (shouldNotify) {
      try {
        await deps.notifyNeedsAttention?.(userId, code);
      } catch {
        // Email failures must not mask the sync failure itself.
      }
    }
    await deps.analytics?.("sync_failed", userId, { code, trigger: opts.trigger, failures });
    return log({ result: "failed", errorCode: code, message: message.slice(0, 300) });
  }
}

async function markHealthy(deps: SyncDeps, conn: EightConnection): Promise<void> {
  if (conn.consecutiveFailures !== 0 || conn.lastErrorCode || conn.status !== "connected" || conn.attentionEmailSentAt) {
    await deps.store.updateConnection(conn.userId, {
      consecutiveFailures: 0,
      lastErrorCode: null,
      status: "connected",
      attentionEmailSentAt: null,
    });
  }
}

/** Best-effort removal of our alarm from the Pod (used by disconnect). */
export async function removeManagedAlarm(deps: SyncDeps, userId: string): Promise<boolean> {
  const conn = await deps.store.getConnection(userId);
  const managed = await deps.store.getManaged(userId);
  if (!conn || !managed) return false;
  try {
    const session = await ensureSession(deps, conn, (deps.now ?? Date.now)());
    await withFreshSession(deps, conn, session, (s) => deps.eight.deleteAlarm(s, managed.eightAlarmId));
    return true;
  } catch {
    return false;
  } finally {
    await deps.store.deleteManaged(userId);
  }
}

export type { ManagedAlarm };
