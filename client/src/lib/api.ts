import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MethodKey } from "@shared/methods";

// Thin fetch wrapper + TanStack hooks. The session is a cookie; nothing is kept client-side.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public payload: unknown = null,
  ) {
    super(code);
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const code = (json as { error?: string } | null)?.error ?? `http_${res.status}`;
    throw new ApiError(res.status, code, json);
  }
  return json as T;
}

export interface Settings {
  cityName: string;
  countryCode: string;
  admin1: string | null;
  lat: number;
  lng: number;
  timezone: string;
  method: MethodKey;
  offsetMinutes: number;
  vibrationEnabled: boolean;
  vibrationPower: 20 | 50 | 100;
  vibrationPattern: "RISE" | "INTENSE";
  thermalEnabled: boolean;
  thermalLevel: number;
  smartWake: boolean;
  paused: boolean;
  updatedAt: string;
}

export type ConnectionStatus = "connected" | "needs_reconnect" | "no_subscription";
export type SyncResult = "updated" | "created" | "recreated" | "skipped" | "paused" | "failed";

export interface Me {
  user: { id: string; email: string; locale: "ar" | "en"; isAdmin: boolean };
  connection: {
    status: ConnectionStatus;
    eightTimezone: string | null;
    connectedAt: string;
    consecutiveFailures: number;
    lastErrorCode: string | null;
    tokenExpiresAt: string | null;
  } | null;
  settings: Settings | null;
  alarm: { scheduledForUtc: string | null; scheduledLocal: string | null; pushedEnabled: boolean; lastPushedAt: string | null; recreatedCount: number } | null;
  lastSync: { startedAt: string; result: SyncResult; errorCode: string | null; trigger: string } | null;
  nextAlarm: { alarmMs: number; fajrMs: number; date: string } | null;
}

export interface SyncOutcome {
  result: SyncResult;
  errorCode?: string;
  message?: string;
  scheduledForUtc?: string;
  scheduledLocal?: string;
}

export interface PreviewEntry {
  date: string;
  fajrMs: number;
  alarmMs: number;
}

export interface AppConfig {
  posthogKey: string | null;
  posthogHost: string;
  mock: boolean;
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("GET", "/api/config"), staleTime: Infinity });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("GET", "/api/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 15_000,
    retry: false,
  });
}

export function useRequestMagicLink() {
  return useMutation({
    mutationFn: (v: { email: string; locale: "ar" | "en" }) => api<{ ok: true; mode: "sent" | "logged" }>("POST", "/api/auth/magic-link", v),
  });
}

export function useVerifyToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { token: string; locale: "ar" | "en" }) => api<{ ok: true }>("POST", "/api/auth/verify", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("POST", "/api/auth/logout"),
    onSuccess: () => qc.setQueryData(["me"], null),
  });
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => api<{ ok: true; eightTimezone: string | null; sync: SyncOutcome | null }>("POST", "/api/connect", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true; alarmRemoved: boolean }>("DELETE", "/api/connect"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export type SettingsInput = Omit<Settings, "paused" | "updatedAt">;

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SettingsInput) => api<{ ok: true; settings: Settings; sync: SyncOutcome | null }>("PUT", "/api/settings", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function usePause() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paused: boolean) => api<{ ok: true; paused: boolean; sync: SyncOutcome | null }>("POST", "/api/settings/pause", { paused }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean; sync: SyncOutcome }>("POST", "/api/sync/now"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useSetLocale() {
  return useMutation({ mutationFn: (locale: "ar" | "en") => api<{ ok: true }>("POST", "/api/auth/locale", { locale }) });
}

export function useFeedback() {
  return useMutation({
    mutationFn: (v: { rating: "up" | "down"; comment?: string; page: string; locale: "ar" | "en" }) => api<{ ok: true }>("POST", "/api/feedback", v),
  });
}

export function usePreview(p: { lat: number; lng: number; timezone: string; method: MethodKey; offsetMinutes: number } | null, days = 7) {
  const qs = p
    ? new URLSearchParams({ lat: String(p.lat), lng: String(p.lng), timezone: p.timezone, method: p.method, offsetMinutes: String(p.offsetMinutes), days: String(days) }).toString()
    : "";
  return useQuery({
    queryKey: ["preview", qs],
    queryFn: () => api<{ timezone: string; entries: PreviewEntry[] }>("GET", `/api/preview?${qs}`),
    enabled: !!p,
    staleTime: 60_000,
  });
}

export interface AdminStats {
  days: number;
  users: number;
  connected: number;
  needsAttention: number;
  paused: number;
  syncsByResult: { result: SyncResult; n: number }[];
  syncsPerDay: { day: string; result: SyncResult; n: number }[];
  topCountries: { key: string; n: number }[];
  topMethods: { key: string; n: number }[];
  errorCodes: { key: string; n: number }[];
  feedback: { up: number; down: number; recent: { id: string; rating: "up" | "down"; comment: string | null; page: string; locale: string; createdAt: string }[] };
}

export function useAdminStats(days = 30) {
  return useQuery({ queryKey: ["admin", days], queryFn: () => api<AdminStats>("GET", `/api/admin/stats?days=${days}`) });
}

export async function fetchDevMagicLink(): Promise<{ email: string; url: string } | null> {
  try {
    return await api<{ email: string; url: string } | null>("GET", "/api/dev/last-magic-link");
  } catch {
    return null;
  }
}
