// Shapes of Eight Sleep's private API as observed in the open-source clients
// (lukas-clarke/eight_sleep "new alarms API" and steipete/eightctl). Anything
// Eight Sleep adds that we don't model is carried through untouched via the
// index signature so PUT round-trips keep unknown fields intact.

export interface EightSession {
  accessToken: string;
  userId: string;
  /** Epoch ms when the access token stops working (from `expires_in`; live value 72000 s ≈ 20 h). */
  expiresAt: number;
  /**
   * Returned by the live token endpoint (verified 2026-10-24) although the reference
   * clients ignore it. Lets us renew without ever touching the password again.
   */
  refreshToken: string | null;
}

export interface EightUser {
  userId: string;
  /**
   * IANA zone the Pod runs on, e.g. "Asia/Riyadh". Live `/users/me` has no top-level
   * timezone; it lives in `currentDevice.timeZone` (and `/devices/{id}.timezone`).
   */
  timezone: string | null;
  deviceId: string | null;
  email: string | null;
  firstName: string | null;
  /** Feature flags from the profile, e.g. ["warming","cooling","vibration","alarms"]. */
  features: string[];
}

export type VibrationPattern = "RISE" | "intense" | string;

export interface EightAlarmVibration {
  enabled: boolean;
  /** 20 | 50 | 100 on create (pyEight: `powerLevel`); some responses use `level`. */
  powerLevel?: number;
  level?: number;
  pattern: VibrationPattern;
  duration?: number;
  [k: string]: unknown;
}

export interface EightAlarmThermal {
  enabled: boolean;
  /** -100..100 on create (pyEight: `level`); some responses use `temperature`. */
  level?: number;
  temperature?: number;
  [k: string]: unknown;
}

export interface EightAlarmRepeat {
  enabled: boolean;
  weekDays: Record<string, boolean>;
  [k: string]: unknown;
}

export interface EightAlarm {
  id: string;
  enabled: boolean;
  /** Wall-clock "HH:MM:SS" in the account's time zone. */
  time: string;
  repeat?: EightAlarmRepeat;
  thermal?: EightAlarmThermal;
  vibration?: EightAlarmVibration;
  // Seen in live responses (eightctl issue #110, Sept 2026); passed through untouched.
  audio?: { enabled: boolean; level?: number; [k: string]: unknown };
  smart?: { lightSleepEnabled?: boolean; sleepCapEnabled?: boolean; sleepCapMinutes?: number; [k: string]: unknown };
  skipNext?: boolean;
  tags?: unknown[];
  snoozing?: boolean;
  // Server-computed; must be stripped before PUT.
  snoozedUntil?: string | null;
  skippedUntil?: string | null;
  nextTimestamp?: string | null;
  startTimestamp?: string | null;
  endTimestamp?: string | null;
  dismissedUntil?: string | null;
  [k: string]: unknown;
}

export type EightVibrationPatternInput = "RISE" | "INTENSE";

export interface EightAlarmInput {
  time: string; // "HH:MM:SS"
  enabled: boolean;
  vibrationEnabled: boolean;
  vibrationPower: number; // 20 | 50 | 100
  vibrationPattern: EightVibrationPatternInput; // RISE = gradual
  thermalEnabled: boolean;
  thermalLevel: number; // -100..100
  /** Eight Sleep "smart" alarm (light-sleep wake, up to 30 min early). */
  smartWake: boolean;
}

export interface EightSleepApi {
  /** Password grant. The password is used for this call only and never retained. */
  login(email: string, password: string): Promise<EightSession>;
  /** Refresh grant. Returns a new session (new access token, usually a rotated refresh token). */
  refresh(session: EightSession): Promise<EightSession>;
  getMe(session: EightSession): Promise<EightUser>;
  listAlarms(session: EightSession): Promise<EightAlarm[]>;
  createAlarm(session: EightSession, input: EightAlarmInput): Promise<EightAlarm>;
  /** Full-object PUT: `existing` minus server fields, with `patch` applied. */
  updateAlarm(session: EightSession, existing: EightAlarm, patch: Partial<EightAlarmInput>): Promise<EightAlarm>;
  deleteAlarm(session: EightSession, alarmId: string): Promise<void>;
}

export const SERVER_ONLY_ALARM_FIELDS = [
  "nextTimestamp",
  "startTimestamp",
  "endTimestamp",
  "dismissedUntil",
  "snoozedUntil",
  "skippedUntil",
] as const;

export function isSessionExpired(session: EightSession, nowMs = Date.now(), skewMs = 120_000): boolean {
  return session.expiresAt - skewMs <= nowMs;
}
