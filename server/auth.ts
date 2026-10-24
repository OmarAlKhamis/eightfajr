import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { Storage } from "./storage";
import { createDb } from "./db";

// Sessions are a signed HttpOnly cookie carrying only the userId — stateless,
// which is exactly what Workers wants. Tampering fails the HMAC check.

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export async function startSession(c: Context<AppEnv>, userId: string): Promise<void> {
  await setSignedCookie(c, COOKIE, userId, c.env.SESSION_SECRET, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: MAX_AGE,
  });
}

export function endSession(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

export const withStorage: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("storage", new Storage(createDb(c.env.DB)));
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = await getSignedCookie(c, c.env.SESSION_SECRET, COOKIE);
  if (!userId) return c.json({ error: "unauthenticated" }, 401);
  const user = await c.get("storage").getUser(userId);
  if (!user) {
    endSession(c);
    return c.json({ error: "session_expired" }, 401);
  }
  c.set("user", user);
  await next();
};

export function isAdmin(c: Context<AppEnv>, email: string | undefined): boolean {
  const admin = c.env.ADMIN_EMAIL?.trim().toLowerCase();
  return !!admin && !!email && email.toLowerCase() === admin;
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAdmin(c, c.get("user")?.email)) return c.json({ error: "forbidden" }, 403);
  await next();
};

// Body helper: tolerate empty/invalid JSON.
export async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const parsed = await c.req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}
