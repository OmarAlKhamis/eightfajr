import type { PostHog } from "posthog-js";
import type { AppConfig } from "./api";

// Privacy-first PostHog (EU): no autocapture, no session recording, no person
// profiles, and no PII in properties. Events are coarse product signals only.
// The SDK is loaded lazily (and only when a key is configured) so it never
// weighs on first paint.

let client: PostHog | null = null;
let loading: Promise<void> | null = null;
const queued: { event: ClientEvent; props: Record<string, string | number | boolean> }[] = [];

export function initAnalytics(cfg: AppConfig | undefined) {
  if (client || loading || !cfg?.posthogKey) return;
  const key = cfg.posthogKey;
  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: cfg.posthogHost,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: "never",
        persistence: "localStorage",
        ip: false,
      });
      client = posthog;
      for (const q of queued.splice(0)) client.capture(q.event, q.props);
    })
    .catch(() => {
      /* analytics is optional */
    });
}

export type ClientEvent = "visit" | "signup_requested" | "feedback_sent" | "language_changed";

export function track(event: ClientEvent, props: Record<string, string | number | boolean> = {}) {
  try {
    if (client) client.capture(event, props);
    else if (loading && queued.length < 20) queued.push({ event, props });
  } catch {
    /* never break the product for analytics */
  }
}
