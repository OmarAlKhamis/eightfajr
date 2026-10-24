// Fajr calculation methods exposed in the UI, mapped onto the `adhan` library.
// Labels live in client/src/i18n; this file is pure data + logic (shared by tests).

export const METHOD_KEYS = [
  "UmmAlQura",
  "MuslimWorldLeague",
  "Egyptian",
  "Karachi",
  "NorthAmerica",
  "Dubai",
  "Qatar",
  "Kuwait",
  "Singapore",
  "Turkey",
  "Tehran",
  "MoonsightingCommittee",
] as const;

export type MethodKey = (typeof METHOD_KEYS)[number];

export function isMethodKey(value: unknown): value is MethodKey {
  return typeof value === "string" && (METHOD_KEYS as readonly string[]).includes(value);
}

// Country (ISO-3166 alpha-2) → default method. Anything unlisted falls back to
// Muslim World League, the most widely used general-purpose convention.
const COUNTRY_DEFAULTS: Record<string, MethodKey> = {
  SA: "UmmAlQura",
  YE: "UmmAlQura",
  BH: "UmmAlQura",
  OM: "UmmAlQura",
  AE: "Dubai",
  QA: "Qatar",
  KW: "Kuwait",
  EG: "Egyptian",
  SD: "Egyptian",
  LY: "Egyptian",
  IQ: "Egyptian",
  JO: "Egyptian",
  LB: "Egyptian",
  SY: "Egyptian",
  PS: "Egyptian",
  MA: "Egyptian",
  DZ: "Egyptian",
  TN: "Egyptian",
  PK: "Karachi",
  IN: "Karachi",
  BD: "Karachi",
  AF: "Karachi",
  US: "NorthAmerica",
  CA: "NorthAmerica",
  GB: "MoonsightingCommittee",
  TR: "Turkey",
  IR: "Tehran",
  SG: "Singapore",
  MY: "Singapore",
  ID: "Singapore",
};

export function defaultMethodForCountry(countryCode: string | null | undefined): MethodKey {
  if (!countryCode) return "MuslimWorldLeague";
  return COUNTRY_DEFAULTS[countryCode.toUpperCase()] ?? "MuslimWorldLeague";
}

export const OFFSET_MIN = -60;
export const OFFSET_MAX = 60;

export function clampOffset(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, Math.round(minutes)));
}

// Analytics-safe bucket (never the exact offset).
export function offsetBucket(minutes: number): string {
  if (minutes <= -31) return "-60..-31";
  if (minutes <= -1) return "-30..-1";
  if (minutes === 0) return "0";
  if (minutes <= 30) return "1..30";
  return "31..60";
}
