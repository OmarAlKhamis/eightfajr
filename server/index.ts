import { Hono } from "hono";
import type { ExecutionContext, ScheduledController } from "@cloudflare/workers-types";
import { withStorage } from "./auth";
import { runScheduledSync } from "./cron";
import type { AppEnv, Env } from "./env";
import { registerRoutes } from "./routes";

// Cloudflare Worker entry. Static client assets are served by the platform
// (wrangler.jsonc `assets`, SPA fallback); only /api/* reaches this code.

const app = new Hono<AppEnv>();

app.use("/api/*", withStorage);

app.use("/api/*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
});

app.onError((err, c) => {
  console.error("Internal Server Error:", err instanceof Error ? err.message : err);
  return c.json({ error: "internal" }, 500);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

registerRoutes(app);

export default {
  fetch: app.fetch,
  // Hourly Fajr sync (wrangler.jsonc triggers.crons).
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledSync(env, "cron"));
  },
};
