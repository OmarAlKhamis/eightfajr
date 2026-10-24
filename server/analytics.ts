import type { Env } from "./env";
import { sha256Hex } from "./crypto";

// Server-side PostHog capture (EU). No PII: the distinct_id is a salted hash of
// the user id and properties are restricted to coarse buckets by the callers.

export type ServerEvent = "eight_sleep_connected" | "settings_saved" | "alarm_synced" | "sync_failed" | "disconnected" | "signup";

export async function distinctId(env: Env, userId: string): Promise<string> {
  return (await sha256Hex(`${env.ANALYTICS_SALT ?? "fajr"}:${userId}`)).slice(0, 32);
}

export async function capture(
  env: Env,
  event: ServerEvent,
  userId: string,
  properties: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  if (!env.POSTHOG_KEY) return;
  const host = (env.POSTHOG_HOST ?? "https://eu.i.posthog.com").replace(/\/$/, "");
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.POSTHOG_KEY,
        event,
        distinct_id: await distinctId(env, userId),
        properties: { ...properties, $lib: "fajr-eight-worker", $process_person_profile: false },
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
  } catch {
    // Analytics must never affect the product path.
  }
}
