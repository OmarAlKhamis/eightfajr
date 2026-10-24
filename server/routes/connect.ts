import type { Hono } from "hono";
import { codeOf, isEightSleepError } from "@eightsleep/index";
import { isValidTimeZone } from "@shared/fajr";
import { capture } from "../analytics";
import { body, requireAuth } from "../auth";
import { buildSyncDeps } from "../cron";
import { encryptString } from "../crypto";
import { nowIso } from "../db";
import { getEightSleep } from "../eight";
import type { AppEnv } from "../env";
import { removeManagedAlarm, syncUser } from "../sync";

export function registerConnectRoutes(app: Hono<AppEnv>) {
  // Exchange Eight Sleep credentials for a token. The password exists only inside
  // this handler's scope: never stored, never logged, never echoed back.
  app.post("/api/connect", requireAuth, async (c) => {
    const b = await body(c);
    const email = String(b.email ?? "").trim();
    const password = String(b.password ?? "");
    if (!email || !password) return c.json({ error: "missing_credentials" }, 400);

    const storage = c.get("storage");
    const user = c.get("user");
    const eight = getEightSleep(c.env);
    try {
      const session = await eight.login(email, password);
      const me = await eight.getMe(session);
      const tz = me.timezone && isValidTimeZone(me.timezone) ? me.timezone : null;
      const existing = await storage.getConnection(user.id);
      const now = nowIso();
      await storage.upsertConnection({
        userId: user.id,
        eightUserId: me.userId || session.userId,
        eightTimezone: tz,
        accessTokenEnc: await encryptString(c.env.TOKEN_ENCRYPTION_KEY, session.accessToken),
        refreshTokenEnc: session.refreshToken ? await encryptString(c.env.TOKEN_ENCRYPTION_KEY, session.refreshToken) : null,
        tokenExpiresAt: nowIso(session.expiresAt),
        eightDeviceId: me.deviceId,
        status: "connected",
        consecutiveFailures: 0,
        attentionEmailSentAt: null,
        lastErrorCode: null,
        connectedAt: existing?.connectedAt ?? now,
        updatedAt: now,
      });
      // Switching Eight Sleep accounts orphans the old alarm id.
      if (existing && existing.eightUserId !== (me.userId || session.userId)) await storage.deleteManaged(user.id);

      c.executionCtx.waitUntil(
        capture(c.env, "eight_sleep_connected", user.id, {
          reconnect: !!existing,
          has_timezone: !!tz,
          has_refresh_token: !!session.refreshToken,
          has_alarms_feature: me.features.includes("alarms"),
        }),
      );

      let sync = null;
      if (await storage.getSettings(user.id)) {
        sync = await syncUser(buildSyncDeps(c.env, storage), user.id, { force: true, trigger: "connect" });
      }
      return c.json({ ok: true, eightTimezone: tz, sync });
    } catch (e) {
      const code = codeOf(e);
      if (isEightSleepError(e)) {
        const status = code === "INVALID_CREDENTIALS" ? 401 : code === "RATE_LIMITED" ? 429 : code === "NETWORK" || code === "SERVER_ERROR" ? 502 : 400;
        return c.json({ error: code }, status);
      }
      console.error("connect failed", e instanceof Error ? e.message : e);
      return c.json({ error: "UNKNOWN" }, 500);
    }
  });

  // Disconnect: best-effort delete of our alarm on the Pod, then delete token + data.
  app.delete("/api/connect", requireAuth, async (c) => {
    const storage = c.get("storage");
    const user = c.get("user");
    const deps = buildSyncDeps(c.env, storage);
    const alarmRemoved = await removeManagedAlarm(deps, user.id);
    await storage.deleteConnection(user.id);
    await storage.deleteSettings(user.id);
    await storage.anonymizeSyncLog(user.id);
    c.executionCtx.waitUntil(capture(c.env, "disconnected", user.id, { alarm_removed: alarmRemoved }));
    return c.json({ ok: true, alarmRemoved });
  });
}
