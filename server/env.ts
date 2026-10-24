import type { D1Database } from "@cloudflare/workers-types";
import type { User } from "@shared/schema";
import type { Storage } from "./storage";

export interface Env {
  DB: D1Database;
  APP_NAME?: string;
  APP_ORIGIN?: string;

  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string; // base64, 32 bytes

  EIGHT_CLIENT_ID?: string;
  EIGHT_CLIENT_SECRET?: string;
  EIGHT_MOCK?: string; // "1" → in-memory fake API

  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;

  ADMIN_EMAIL?: string;

  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  ANALYTICS_SALT?: string;

  CRON_SECRET?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    storage: Storage;
    user: User;
  };
};

export function isMock(env: Env): boolean {
  return env.EIGHT_MOCK === "1" || env.EIGHT_MOCK === "true";
}

export function appOrigin(env: Env, requestUrl: string): string {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/$/, "");
  return new URL(requestUrl).origin;
}
