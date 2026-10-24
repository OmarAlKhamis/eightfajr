import { Hono } from "hono";
import type { ExecutionContext, ScheduledController } from "@cloudflare/workers-types";
import { withStorage } from "./auth";
import { runScheduledSync } from "./cron";
import type { AppEnv, Env } from "./env";
import { registerRoutes } from "./routes";

// Cloudflare Worker entry. Static client assets are served by the platform
// (wrangler.jsonc `assets`, SPA fallback); only /api/* reaches this code.

const app = new Hono<AppEnv>();

// Canonical host: APP_ORIGIN (https://eightfajr.com in production). Anything
// else that reaches this Worker (www, the workers.dev URL) is redirected there.
// Local dev sets APP_ORIGIN to the dev server, so nothing redirects locally.
app.use("*", async (c, next) => {
  const origin = c.env.APP_ORIGIN;
  if (origin) {
    const canonical = new URL(origin);
    const url = new URL(c.req.url);
    if (url.host !== canonical.host) {
      url.protocol = canonical.protocol;
      url.host = canonical.host;
      return c.redirect(url.toString(), 301);
    }
  }
  await next();
});

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

// Everything that is not an API route is a static asset or the SPA shell.
app.get("*", (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw as unknown as Parameters<typeof c.env.ASSETS.fetch>[0]) as unknown as Promise<Response>;
});

export default {
  fetch: app.fetch,
  // Hourly Fajr sync (wrangler.jsonc triggers.crons).
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledSync(env, "cron"));
  },
};
