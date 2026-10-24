import { EightSleepError, errorFromStatus } from "./errors";
import { withRetry, type RetryOptions } from "./queue";
import {
  SERVER_ONLY_ALARM_FIELDS,
  type EightAlarm,
  type EightAlarmInput,
  type EightSession,
  type EightSleepApi,
  type EightUser,
} from "./types";

// Real client. Endpoints and payloads mirror lukas-clarke/eight_sleep (pyEight,
// "new alarms API") with the auth flow shared by steipete/eightctl:
//   POST https://auth-api.8slp.net/v1/tokens            password grant (JSON)
//   GET  https://client-api.8slp.net/v1/users/me         profile incl. timezone
//   GET  https://app-api.8slp.net/v2/users/{id}/alarms   { alarms: [...] }
//   POST https://app-api.8slp.net/v1/users/{id}/alarms   create (no `repeat` = one-off)
//   PUT  https://app-api.8slp.net/v1/users/{id}/alarms/{alarmId}   full object
//   DELETE https://app-api.8slp.net/v1/users/{id}/alarms/{alarmId}
// If Eight Sleep changes something, this file (and types.ts) is the only place to fix.

export const AUTH_URL = "https://auth-api.8slp.net/v1/tokens";
export const CLIENT_API_URL = "https://client-api.8slp.net/v1";
export const APP_API_URL = "https://app-api.8slp.net";

export interface ClientOptions {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
  timeoutMs?: number;
  userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_UA = "okhttp/4.9.3";

type Json = Record<string, unknown>;

export function createEightSleepClient(opts: ClientOptions): EightSleepApi {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ua = opts.userAgent ?? DEFAULT_UA;

  async function request(
    method: string,
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; json: unknown; text: string; retryAfterMs?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          accept: "application/json",
          "user-agent": ua,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const reason = e instanceof Error ? e.name : "error";
      throw new EightSleepError("NETWORK", `Network error talking to Eight Sleep (${reason})`);
    }
    clearTimeout(timer);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const ra = res.headers.get("retry-after");
    const retryAfterMs = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : undefined;
    return { status: res.status, json, text, retryAfterMs };
  }

  // Short, sanitised excerpt for error classification only (never logged raw).
  function snippet(text: string): string {
    return text.slice(0, 200);
  }

  async function authed(
    session: EightSession,
    method: string,
    url: string,
    body?: unknown,
  ): Promise<unknown> {
    return withRetry(async () => {
      const r = await request(method, url, body, { authorization: `Bearer ${session.accessToken}` });
      if (r.status >= 200 && r.status < 300) return r.json;
      throw errorFromStatus(r.status, snippet(r.text), r.retryAfterMs);
    }, opts.retry);
  }

  return {
    async login(email, password) {
      // Not retried on 4xx; retried on 429/5xx/network like everything else.
      const r = await withRetry(async () => {
        const res = await request(
          "POST",
          AUTH_URL,
          {
            client_id: opts.clientId,
            client_secret: opts.clientSecret,
            grant_type: "password",
            username: email,
            password,
          },
          {},
        );
        if (res.status >= 200 && res.status < 300) return res;
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          throw new EightSleepError("INVALID_CREDENTIALS", "Eight Sleep rejected the email or password", {
            status: res.status,
          });
        }
        throw errorFromStatus(res.status, snippet(res.text), res.retryAfterMs);
      }, opts.retry);

      const j = (r.json ?? {}) as Json;
      const accessToken = typeof j.access_token === "string" ? j.access_token : "";
      const userId = typeof j.userId === "string" ? j.userId : "";
      const expiresIn = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 3600;
      if (!accessToken || !userId) {
        throw new EightSleepError("UNEXPECTED_RESPONSE", "Eight Sleep login response missing access_token/userId");
      }
      return { accessToken, userId, expiresAt: Date.now() + expiresIn * 1000 };
    },

    async getMe(session) {
      const j = (await authed(session, "GET", `${CLIENT_API_URL}/users/me`)) as Json | null;
      const u = ((j?.user as Json | undefined) ?? j ?? {}) as Json;
      const userId = typeof u.userId === "string" ? u.userId : typeof u.id === "string" ? u.id : session.userId;
      return {
        userId,
        timezone: typeof u.timezone === "string" && u.timezone ? u.timezone : null,
        email: typeof u.email === "string" ? u.email : null,
        firstName: typeof u.firstName === "string" ? u.firstName : null,
      } satisfies EightUser;
    },

    async listAlarms(session) {
      const j = (await authed(session, "GET", `${APP_API_URL}/v2/users/${session.userId}/alarms`)) as Json | null;
      const alarms = j?.alarms;
      if (!Array.isArray(alarms)) {
        throw new EightSleepError("UNEXPECTED_RESPONSE", "Eight Sleep alarms list has no `alarms` array");
      }
      return alarms.filter((a): a is EightAlarm => !!a && typeof a === "object" && typeof (a as Json).id === "string");
    },

    async createAlarm(session, input) {
      const body = {
        time: input.time,
        enabled: input.enabled,
        vibration: { enabled: input.vibrationEnabled, powerLevel: input.vibrationPower, pattern: "RISE" },
        thermal: { enabled: input.thermalEnabled, level: input.thermalLevel },
      };
      const j = (await authed(session, "POST", `${APP_API_URL}/v1/users/${session.userId}/alarms`, body)) as Json | null;
      const created = unwrapAlarm(j);
      if (created) return created;
      // Some builds return an empty body on create: find ours by time among the list.
      const all = await this.listAlarms(session);
      const match = all.find((a) => a.time === input.time && !a.repeat?.enabled);
      if (!match) throw new EightSleepError("UNEXPECTED_RESPONSE", "Created alarm not found in alarms list");
      return match;
    },

    async updateAlarm(session, existing, patch) {
      const body: Json = { ...existing };
      for (const f of SERVER_ONLY_ALARM_FIELDS) delete body[f];
      if (patch.time !== undefined) body.time = patch.time;
      if (patch.enabled !== undefined) body.enabled = patch.enabled;
      const vib = { ...((existing.vibration as Json | undefined) ?? { pattern: "RISE" }) };
      if (patch.vibrationEnabled !== undefined) vib.enabled = patch.vibrationEnabled;
      if (patch.vibrationPower !== undefined) {
        // Keep whichever key the server used; default to pyEight's `powerLevel`.
        if ("level" in vib && !("powerLevel" in vib)) vib.level = patch.vibrationPower;
        else vib.powerLevel = patch.vibrationPower;
      }
      body.vibration = vib;
      const th = { ...((existing.thermal as Json | undefined) ?? {}) };
      if (patch.thermalEnabled !== undefined) th.enabled = patch.thermalEnabled;
      if (patch.thermalLevel !== undefined) {
        if ("temperature" in th && !("level" in th)) th.temperature = patch.thermalLevel;
        else th.level = patch.thermalLevel;
      }
      body.thermal = th;
      const j = (await authed(
        session,
        "PUT",
        `${APP_API_URL}/v1/users/${session.userId}/alarms/${encodeURIComponent(existing.id)}`,
        body,
      )) as Json | null;
      return unwrapAlarm(j) ?? ({ ...(body as EightAlarm) } as EightAlarm);
    },

    async deleteAlarm(session, alarmId) {
      try {
        await authed(session, "DELETE", `${APP_API_URL}/v1/users/${session.userId}/alarms/${encodeURIComponent(alarmId)}`);
      } catch (e) {
        if (e instanceof EightSleepError && e.code === "NOT_FOUND") return; // already gone
        throw e;
      }
    },
  };
}

function unwrapAlarm(j: Json | null): EightAlarm | null {
  if (!j) return null;
  const inner = (j.alarm as Json | undefined) ?? j;
  return typeof inner.id === "string" ? (inner as EightAlarm) : null;
}
