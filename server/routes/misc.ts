import type { Hono } from "hono";
import { EightSleepError, type EightErrorCode } from "@eightsleep/index";
import { body, requireAdmin, requireAuth } from "../auth";
import { runScheduledSync } from "../cron";
import { timingSafeEqual } from "../crypto";
import { nowIso } from "../db";
import { getMock } from "../eight";
import { getLastDevMagicLink } from "../email";
import { isMock, type AppEnv } from "../env";

export function registerMiscRoutes(app: Hono<AppEnv>) {
  // Same job as the Cron Trigger, callable by hand / CI with the shared secret.
  app.post("/api/sync/run", async (c) => {
    const secret = c.env.CRON_SECRET ?? "";
    const given = c.req.header("x-cron-secret") ?? "";
    if (!secret || !timingSafeEqual(secret, given)) return c.json({ error: "forbidden" }, 403);
    const summary = await runScheduledSync(c.env, "manual");
    return c.json(summary);
  });

  app.post("/api/feedback", async (c) => {
    const b = await body(c);
    const rating = b.rating === "up" || b.rating === "down" ? b.rating : null;
    if (!rating) return c.json({ error: "invalid_rating" }, 400);
    const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, 1000) : "";
    const page = typeof b.page === "string" ? b.page.slice(0, 80) : "unknown";
    const locale = b.locale === "en" ? "en" : "ar";
    // Attach the user when signed in, without requiring it.
    let userId: string | null = null;
    try {
      const { getSignedCookie } = await import("hono/cookie");
      userId = (await getSignedCookie(c, c.env.SESSION_SECRET, "session")) || null;
    } catch {
      userId = null;
    }
    await c.get("storage").insertFeedback({ userId, rating, comment: comment || null, page, locale, createdAt: nowIso() });
    return c.json({ ok: true });
  });

  app.get("/api/admin/stats", requireAuth, requireAdmin, async (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30)));
    const stats = await c.get("storage").adminStats(nowIso(Date.now() - days * 86_400_000));
    return c.json({ days, ...stats });
  });

  app.get("/api/health", (c) => c.json({ ok: true, mock: isMock(c.env), at: nowIso() }));

  // ---- dev-only helpers (mock mode): let the smoke test script the fake Pod ----
  app.use("/api/dev/*", async (c, next) => {
    if (!isMock(c.env)) return c.json({ error: "not_found" }, 404);
    await next();
  });
  app.get("/api/dev/last-magic-link", (c) => c.json(getLastDevMagicLink()));
  app.get("/api/dev/mock/alarms", (c) => {
    const m = getMock();
    const out: Record<string, unknown> = {};
    for (const [userId, alarms] of m.alarms) out[userId] = alarms;
    return c.json({ alarms: out, calls: m.calls });
  });
  app.post("/api/dev/mock/delete-alarm", async (c) => {
    const b = await body(c);
    const m = getMock();
    const userId = String(b.userId ?? "mock-user-1");
    const list = m.alarms.get(userId) ?? [];
    const target = typeof b.alarmId === "string" ? b.alarmId : list[0]?.id;
    return c.json({ ok: !!target && m.deleteAlarmExternally(userId, target) });
  });
  app.post("/api/dev/mock/fail-next", async (c) => {
    const b = await body(c);
    const op = (typeof b.op === "string" ? b.op : "any") as Parameters<ReturnType<typeof getMock>["failNext"]>[0];
    const code = (typeof b.code === "string" ? b.code : "RATE_LIMITED") as EightErrorCode;
    const status = code === "RATE_LIMITED" ? 429 : code === "AUTH_FAILED" ? 401 : code === "NO_SUBSCRIPTION" ? 403 : 500;
    const times = Math.min(10, Math.max(1, Number(b.times ?? 1)));
    for (let i = 0; i < times; i++) getMock().failNext(op, new EightSleepError(code, `mock scripted ${code}`, { status }));
    return c.json({ ok: true, op, code, times });
  });
  app.post("/api/dev/mock/revoke", (c) => {
    getMock().revokeAllTokens();
    return c.json({ ok: true });
  });
  app.post("/api/dev/mock/reset-calls", (c) => {
    const m = getMock();
    for (const k of Object.keys(m.calls) as (keyof typeof m.calls)[]) m.calls[k] = 0;
    return c.json({ ok: true });
  });
}
