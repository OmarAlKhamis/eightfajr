// Shapes of Eight Sleep's private API as observed in the open-source clients
// (lukas-clarke/eight_sleep "new alarms API" and steipete/eightctl). Anything
// Eight Sleep adds that we don't model is carried through untouched via the
// index signature so PUT round-trips keep unknown fields intact.

export interface EightSession {
  accessToken: string;
  userId: string;
  /** Epoch ms when the token stops working (from `expires_in`). */
  expiresAt: number;
}

export interface EightUser {
  userId: string;
  /** IANA zone of the profile, e.g. "Asia/Riyadh". May be missing on some accounts. */
  timezone: string | null;
  email: string | null;
  firstName: string | null;
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
  snoozing?: boolean;
  // Server-computed; must be stripped before PUT.
  snoozedUntil?: string | null;
  nextTimestamp?: string | null;
  startTimestamp?: string | null;
  endTimestamp?: string | null;
  dismissedUntil?: string | null;
  [k: string]: unknown;
}

export interface EightAlarmInput {
  time: string; // "HH:MM:SS"
  enabled: boolean;
  vibrationEnabled: boolean;
  vibrationPower: number; // 20 | 50 | 100
  thermalEnabled: boolean;
  thermalLevel: number; // -100..100
}

export interface EightSleepApi {
  /** Password grant. The password is used for this call only and never retained. */
  login(email: string, password: string): Promise<EightSession>;
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
] as const;

export function isSessionExpired(session: EightSession, nowMs = Date.now(), skewMs = 120_000): boolean {
  return session.expiresAt - skewMs <= nowMs;
}
