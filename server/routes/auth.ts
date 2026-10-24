import type { Hono } from "hono";
import { nextAlarmAfter } from "@shared/fajr";
import { isMethodKey } from "@shared/methods";
import { capture } from "../analytics";
import { body, endSession, isAdmin, looksLikeEmail, requireAuth, startSession } from "../auth";
import { randomToken, sha256Hex } from "../crypto";
import { nowIso } from "../db";
import { sendMagicLink } from "../email";
import { appOrigin, type AppEnv } from "../env";

const LINK_TTL_MS = 15 * 60_000;
const MAX_LINKS_PER_HOUR = 5;

export function registerAuthRoutes(app: Hono<AppEnv>) {
  // Step 1: request a magic link.
  app.post("/api/auth/magic-link", async (c) => {
    const b = await body(c);
    const email = String(b.email ?? "").trim().toLowerCase();
    const locale = b.locale === "en" ? "en" : "ar";
    if (!looksLikeEmail(email) || email.length > 254) return c.json({ error: "invalid_email" }, 400);

    const storage = c.get("storage");
    const recent = await storage.countRecentMagicLinks(email, nowIso(Date.now() - 3_600_000));
    if (recent >= MAX_LINKS_PER_HOUR) return c.json({ error: "too_many_requests" }, 429);

    const token = randomToken();
    await storage.createMagicLink(email, await sha256Hex(token), nowIso(Date.now() + LINK_TTL_MS));
    const url = `${appOrigin(c.env, c.req.url)}/auth/verify?token=${token}&locale=${locale}`;
    const mode = await sendMagicLink(c.env, email, url, locale);
    return c.json({ ok: true, mode });
  });

  // Step 2: the link lands here (GET from the email client), sets the cookie, redirects.
  app.get("/api/auth/verify", async (c) => {
    const token = c.req.query("token") ?? "";
    const locale = c.req.query("locale") === "en" ? "en" : "ar";
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return c.redirect("/signin?error=invalid");
    const storage = c.get("storage");
    const link = await storage.consumeMagicLink(await sha256Hex(token));
    if (!link) return c.redirect("/signin?error=expired");

    const { user, created } = await storage.getOrCreateUser(link.email, locale);
    await storage.touchLogin(user.id);
    await startSession(c, user.id);
    if (created) c.executionCtx.waitUntil(capture(c.env, "signup", user.id, { locale }));

    const conn = await storage.getConnection(user.id);
    const settings = await storage.getSettings(user.id);
    return c.redirect(!conn ? "/connect" : !settings ? "/settings?first=1" : "/settings");
  });

  // JSON variant for the SPA (when the user opens the link in the app itself).
  app.post("/api/auth/verify", async (c) => {
    const b = await body(c);
    const token = String(b.token ?? "");
    const locale = b.locale === "en" ? "en" : "ar";
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return c.json({ error: "invalid" }, 400);
    const storage = c.get("storage");
    const link = await storage.consumeMagicLink(await sha256Hex(token));
    if (!link) return c.json({ error: "expired" }, 400);
    const { user, created } = await storage.getOrCreateUser(link.email, locale);
    await storage.touchLogin(user.id);
    await startSession(c, user.id);
    if (created) c.executionCtx.waitUntil(capture(c.env, "signup", user.id, { locale }));
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", async (c) => {
    endSession(c);
    return c.json({ ok: true });
  });

  app.post("/api/auth/locale", requireAuth, async (c) => {
    const b = await body(c);
    const locale = b.locale === "en" ? "en" : "ar";
    await c.get("storage").setLocale(c.get("user").id, locale);
    return c.json({ ok: true });
  });

  // Everything the dashboard needs in one call.
  app.get("/api/auth/me", requireAuth, async (c) => {
    const storage = c.get("storage");
    const user = c.get("user");
    const [conn, settings, managed, lastSync] = await Promise.all([
      storage.getConnection(user.id),
      storage.getSettings(user.id),
      storage.getManaged(user.id),
      storage.lastSync(user.id),
    ]);
    let nextAlarm: { alarmMs: number; fajrMs: number; date: string } | null = null;
    if (settings && isMethodKey(settings.method) && !settings.paused) {
      try {
        nextAlarm = nextAlarmAfter(Date.now(), {
          lat: settings.lat,
          lng: settings.lng,
          timezone: settings.timezone,
          method: settings.method,
          offsetMinutes: settings.offsetMinutes,
        });
      } catch {
        nextAlarm = null;
      }
    }
    return c.json({
      user: { id: user.id, email: user.email, locale: user.locale, isAdmin: isAdmin(c, user.email) },
      connection: conn
        ? {
            status: conn.status,
            eightTimezone: conn.eightTimezone,
            connectedAt: conn.connectedAt,
            consecutiveFailures: conn.consecutiveFailures,
            lastErrorCode: conn.lastErrorCode,
            tokenExpiresAt: conn.tokenExpiresAt,
          }
        : null,
      settings,
      alarm: managed
        ? {
            scheduledForUtc: managed.scheduledForUtc,
            scheduledLocal: managed.scheduledLocal,
            pushedEnabled: managed.pushedEnabled,
            lastPushedAt: managed.lastPushedAt,
            recreatedCount: managed.recreatedCount,
          }
        : null,
      lastSync: lastSync ? { startedAt: lastSync.startedAt, result: lastSync.result, errorCode: lastSync.errorCode, trigger: lastSync.trigger } : null,
      nextAlarm,
    });
  });
}
