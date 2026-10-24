import type { Locale } from "@/i18n";

// All time formatting is explicit about the IANA zone; never the browser's.
const intlLocale = (l: Locale) => (l === "ar" ? "ar-SA-u-nu-latn" : "en-GB");

export function fmtTime(ms: number | string, tz: string, locale: Locale): string {
  const d = typeof ms === "string" ? new Date(ms) : new Date(ms);
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
}

export function fmtDate(ms: number | string, tz: string, locale: Locale, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = typeof ms === "string" ? new Date(ms) : new Date(ms);
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, weekday: "short", day: "numeric", month: "short", ...opts }).format(d);
}

export function fmtDateTime(ms: number | string, tz: string, locale: Locale): string {
  return `${fmtDate(ms, tz, locale)} · ${fmtTime(ms, tz, locale)}`;
}

export function fmtRelative(iso: string, locale: Locale, nowMs = Date.now()): string {
  const diff = Date.parse(iso) - nowMs;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

/** The browser's zone, for "use my location"-less defaults. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function countryName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale === "ar" ? "ar" : "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
