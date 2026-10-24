import { CalculationMethod, Coordinates, HighLatitudeRule, PrayerTimes } from "adhan";
import type { CalculationParameters } from "adhan";
import type { MethodKey } from "./methods";

// Pure Fajr + alarm-time logic. No I/O, no process time zone assumptions:
// every calendar computation is done in the city's IANA zone through Intl,
// and every result is an absolute UTC instant (epoch milliseconds).

export interface FajrSettings {
  lat: number;
  lng: number;
  timezone: string; // IANA zone of the city
  method: MethodKey;
  offsetMinutes: number; // negative = before Fajr
}

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface AlarmPreviewEntry {
  date: string; // YYYY-MM-DD in the city zone
  fajrMs: number;
  alarmMs: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

const methodFactories: Record<MethodKey, () => CalculationParameters> = {
  UmmAlQura: () => CalculationMethod.UmmAlQura(),
  MuslimWorldLeague: () => CalculationMethod.MuslimWorldLeague(),
  Egyptian: () => CalculationMethod.Egyptian(),
  Karachi: () => CalculationMethod.Karachi(),
  NorthAmerica: () => CalculationMethod.NorthAmerica(),
  Dubai: () => CalculationMethod.Dubai(),
  Qatar: () => CalculationMethod.Qatar(),
  Kuwait: () => CalculationMethod.Kuwait(),
  Singapore: () => CalculationMethod.Singapore(),
  Turkey: () => CalculationMethod.Turkey(),
  Tehran: () => CalculationMethod.Tehran(),
  MoonsightingCommittee: () => CalculationMethod.MoonsightingCommittee(),
};

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

function zonedParts(ms: number, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  // Some engines report midnight as 24 with hour12:false; h23 avoids it, but be safe.
  if (out.hour === 24) out.hour = 0;
  return out;
}

// Calendar date of an instant in a zone.
export function localDateOf(ms: number, tz: string): LocalDate {
  const p = zonedParts(ms, tz);
  return { year: p.year!, month: p.month!, day: p.day! };
}

export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function formatLocalDate(d: LocalDate): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}

// "HH:MM:SS" wall-clock of an instant in a zone — the format Eight Sleep alarms use.
export function formatTimeInTz(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  const hh = String(p.hour!).padStart(2, "0");
  const mm = String(p.minute!).padStart(2, "0");
  const ss = String(p.second!).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function buildParams(method: MethodKey, coords: Coordinates): CalculationParameters {
  const params = methodFactories[method]();
  // Angle-based rule (the convention behind most published tables, incl. AlAdhan):
  // it only alters Fajr when true twilight never occurs, so London in March still
  // gets the real 18° time. adhan's recommended() (1/7 night above 48°) would
  // shift London ~20 min later even when twilight exists.
  void coords;
  params.highLatitudeRule = HighLatitudeRule.TwilightAngle;
  return params;
}

// Fajr instant (epoch ms) on a given calendar day of the city. adhan reads only
// year/month/day from the Date and ignores the process zone when built with the
// local-time constructor, so this is deterministic wherever it runs.
export function fajrOn(date: LocalDate, s: FajrSettings): number {
  const coords = new Coordinates(s.lat, s.lng);
  const d = new Date(date.year, date.month - 1, date.day, 12, 0, 0);
  const pt = new PrayerTimes(coords, d, buildParams(s.method, coords));
  const ms = pt.fajr.getTime();
  if (!Number.isFinite(ms)) throw new Error(`Fajr is undefined for ${formatLocalDate(date)} at ${s.lat},${s.lng}`);
  return ms;
}

export function alarmOn(date: LocalDate, s: FajrSettings): { fajrMs: number; alarmMs: number } {
  const fajrMs = fajrOn(date, s);
  return { fajrMs, alarmMs: fajrMs + s.offsetMinutes * MINUTE };
}

// The first alarm instant strictly after `nowMs`. Scans yesterday..+2 days in the
// city zone so negative offsets that cross midnight and DST days are handled.
export function nextAlarmAfter(nowMs: number, s: FajrSettings): AlarmPreviewEntry {
  const today = localDateOf(nowMs, s.timezone);
  for (let k = -1; k <= 2; k++) {
    const date = addDays(today, k);
    const { fajrMs, alarmMs } = alarmOn(date, s);
    if (alarmMs > nowMs) return { date: formatLocalDate(date), fajrMs, alarmMs };
  }
  // Unreachable for |offset| <= 60 min, kept for type safety.
  throw new Error("No upcoming alarm found");
}

// Upcoming alarms, starting with the next one. Used by the settings preview.
export function previewAlarms(nowMs: number, s: FajrSettings, days = 7): AlarmPreviewEntry[] {
  const first = nextAlarmAfter(nowMs, s);
  const start = parseLocalDate(first.date);
  const out: AlarmPreviewEntry[] = [first];
  for (let k = 1; k < days; k++) {
    const date = addDays(start, k);
    const { fajrMs, alarmMs } = alarmOn(date, s);
    out.push({ date: formatLocalDate(date), fajrMs, alarmMs });
  }
  return out;
}

export function parseLocalDate(s: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Bad date: ${s}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export { DAY as DAY_MS, MINUTE as MINUTE_MS };
