import type { Hono } from "hono";
import { z } from "zod";
import { isValidTimeZone, previewAlarms, type FajrSettings } from "@shared/fajr";
import { METHOD_KEYS, OFFSET_MAX, OFFSET_MIN, offsetBucket } from "@shared/methods";
import { capture } from "../analytics";
import { body, requireAuth } from "../auth";
import { buildSyncDeps } from "../cron";
import { nowIso } from "../db";
import type { AppEnv } from "../env";
import { syncUser } from "../sync";

const settingsSchema = z.object({
  cityName: z.string().trim().min(1).max(120),
  countryCode: z.string().trim().length(2).transform((s) => s.toUpperCase()),
  admin1: z.string().trim().max(120).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timezone: z.string().refine(isValidTimeZone, "invalid_timezone"),
  method: z.enum(METHOD_KEYS),
  offsetMinutes: z.number().int().min(OFFSET_MIN).max(OFFSET_MAX),
  vibrationEnabled: z.boolean().default(true),
  vibrationPower: z.union([z.literal(20), z.literal(50), z.literal(100)]).default(50),
  vibrationPattern: z.enum(["RISE", "INTENSE"]).default("RISE"),
  thermalEnabled: z.boolean().default(true),
  thermalLevel: z.number().int().min(-100).max(100).default(0),
  smartWake: z.boolean().default(false),
});

const previewSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  timezone: z.string().refine(isValidTimeZone, "invalid_timezone"),
  method: z.enum(METHOD_KEYS),
  offsetMinutes: z.coerce.number().int().min(OFFSET_MIN).max(OFFSET_MAX).default(0),
  days: z.coerce.number().int().min(1).max(14).default(7),
});

export function registerSettingsRoutes(app: Hono<AppEnv>) {
  // Pure computation; no auth so the landing page can show a live example.
  app.get("/api/preview", async (c) => {
    const parsed = previewSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.map((i) => i.path.join(".")) }, 400);
    const { days, ...s } = parsed.data;
    const list = previewAlarms(Date.now(), s as FajrSettings, days);
    return c.json({ timezone: s.timezone, entries: list });
  });

  app.put("/api/settings", requireAuth, async (c) => {
    const parsed = settingsSchema.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.map((i) => i.path.join(".")) }, 400);
    const storage = c.get("storage");
    const user = c.get("user");
    const prev = await storage.getSettings(user.id);
    const row = {
      userId: user.id,
      ...parsed.data,
      admin1: parsed.data.admin1 ?? null,
      paused: prev?.paused ?? false,
      updatedAt: nowIso(),
    };
    await storage.upsertSettings(row);
    c.executionCtx.waitUntil(
      capture(c.env, "settings_saved", user.id, {
        method: row.method,
        offset_bucket: offsetBucket(row.offsetMinutes),
        country: row.countryCode,
        first_time: !prev,
      }),
    );
    // Applies to the next alarm immediately (when connected and not paused).
    let sync = null;
    if (await storage.getConnection(user.id)) {
      sync = await syncUser(buildSyncDeps(c.env, storage), user.id, { force: true, trigger: "settings" });
    }
    return c.json({ ok: true, settings: row, sync });
  });

  app.post("/api/settings/pause", requireAuth, async (c) => {
    const b = await body(c);
    const paused = b.paused === true;
    const storage = c.get("storage");
    const user = c.get("user");
    if (!(await storage.getSettings(user.id))) return c.json({ error: "no_settings" }, 400);
    await storage.setPaused(user.id, paused);
    let sync = null;
    if (await storage.getConnection(user.id)) {
      sync = await syncUser(buildSyncDeps(c.env, storage), user.id, { force: true, trigger: paused ? "pause" : "resume" });
    }
    return c.json({ ok: true, paused, sync });
  });

  // Manual "sync now" from the dashboard.
  app.post("/api/sync/now", requireAuth, async (c) => {
    const storage = c.get("storage");
    const user = c.get("user");
    if (!(await storage.getConnection(user.id))) return c.json({ error: "not_connected" }, 400);
    if (!(await storage.getSettings(user.id))) return c.json({ error: "no_settings" }, 400);
    const sync = await syncUser(buildSyncDeps(c.env, storage), user.id, { force: true, trigger: "manual" });
    return c.json({ ok: sync.result !== "failed", sync });
  });
}
