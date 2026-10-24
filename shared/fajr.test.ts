import { describe, expect, it } from "vitest";
import {
  addDays,
  fajrOn,
  formatLocalDate,
  formatTimeInTz,
  isValidTimeZone,
  localDateOf,
  nextAlarmAfter,
  previewAlarms,
  type FajrSettings,
} from "./fajr";
import { clampOffset, defaultMethodForCountry, offsetBucket } from "./methods";

// Reference values fetched from api.aladhan.com (which uses the same published
// method parameters). We allow ±2 minutes: rounding conventions differ slightly.
const RIYADH: FajrSettings = { lat: 24.7136, lng: 46.6753, timezone: "Asia/Riyadh", method: "UmmAlQura", offsetMinutes: 0 };
const LONDON: FajrSettings = { lat: 51.5074, lng: -0.1278, timezone: "Europe/London", method: "MuslimWorldLeague", offsetMinutes: 0 };
const NYC: FajrSettings = { lat: 40.7128, lng: -74.006, timezone: "America/New_York", method: "NorthAmerica", offsetMinutes: 0 };
const ISTANBUL: FajrSettings = { lat: 41.0082, lng: 28.9784, timezone: "Europe/Istanbul", method: "Turkey", offsetMinutes: 0 };
const DUBAI: FajrSettings = { lat: 25.2048, lng: 55.2708, timezone: "Asia/Dubai", method: "Dubai", offsetMinutes: 0 };
const CAIRO: FajrSettings = { lat: 30.0444, lng: 31.2357, timezone: "Africa/Cairo", method: "Egyptian", offsetMinutes: 0 };

function hhmm(ms: number, tz: string): string {
  return formatTimeInTz(ms, tz).slice(0, 5);
}

function minutesOf(hhmmStr: string): number {
  const [h, m] = hhmmStr.split(":").map(Number);
  return h! * 60 + m!;
}

function expectClose(actual: string, expected: string, toleranceMin = 2) {
  expect(Math.abs(minutesOf(actual) - minutesOf(expected))).toBeLessThanOrEqual(toleranceMin);
}

describe("fajrOn across methods and zones (vs AlAdhan reference)", () => {
  it("Riyadh, Umm al-Qura, 2026-10-24 → 04:37", () => {
    expectClose(hhmm(fajrOn({ year: 2026, month: 10, day: 24 }, RIYADH), RIYADH.timezone), "04:37");
  });
  it("London, MWL, day before DST starts (2026-03-28) → 03:49 GMT", () => {
    expectClose(hhmm(fajrOn({ year: 2026, month: 3, day: 28 }, LONDON), LONDON.timezone), "03:49");
  });
  it("London, MWL, DST start day (2026-03-29) → 04:46 BST", () => {
    expectClose(hhmm(fajrOn({ year: 2026, month: 3, day: 29 }, LONDON), LONDON.timezone), "04:46");
  });
  it("New York, ISNA, day before DST ends (2026-10-31) → 06:09 EDT", () => {
    expectClose(hhmm(fajrOn({ year: 2026, month: 10, day: 31 }, NYC), NYC.timezone), "06:09");
  });
  it("New York, ISNA, DST end day (2026-11-01) → 05:10 EST", () => {
    expectClose(hhmm(fajrOn({ year: 2026, month: 11, day: 1 }, NYC), NYC.timezone), "05:10");
  });
  it("Istanbul, Turkey (Diyanet), 2026-06-21 → 03:24", () => {
    expectClose(hhmm(fajrOn({ year: 2026, month: 6, day: 21 }, ISTANBUL), ISTANBUL.timezone), "03:24", 3);
  });
  it("Dubai, 2026-01-15 → 05:45", () => {
    expectClose(hhmm(fajrOn({ year: 2026, month: 1, day: 15 }, DUBAI), DUBAI.timezone), "05:45");
  });
  it("Cairo, Egyptian, 2026-04-10 → 04:04", () => {
    expectClose(hhmm(fajrOn({ year: 2026, month: 4, day: 10 }, CAIRO), CAIRO.timezone), "04:04");
  });
  it("is independent of the process time zone (same instant for the same calendar day)", () => {
    const a = fajrOn({ year: 2026, month: 10, day: 24 }, RIYADH);
    // Re-running with identical inputs must be identical; the implementation builds
    // the Date with the local-time constructor so adhan reads the intended y/m/d.
    expect(fajrOn({ year: 2026, month: 10, day: 24 }, RIYADH)).toBe(a);
    expect(new Date(a).toISOString().startsWith("2026-10-24T01:3")).toBe(true); // 04:3x +03 = 01:3x UTC
  });
  it("does not blow up at high latitude in midsummer (Reykjavik, MWL)", () => {
    const REYK: FajrSettings = { lat: 64.1466, lng: -21.9426, timezone: "Atlantic/Reykjavik", method: "MuslimWorldLeague", offsetMinutes: 0 };
    const ms = fajrOn({ year: 2026, month: 6, day: 21 }, REYK);
    expect(Number.isFinite(ms)).toBe(true);
  });
});

describe("offset and next-alarm logic", () => {
  it("applies a negative offset before Fajr and a positive one after", () => {
    const base = fajrOn({ year: 2026, month: 10, day: 24 }, RIYADH);
    const before = nextAlarmAfter(base - 3 * 3_600_000, { ...RIYADH, offsetMinutes: -20 });
    const after = nextAlarmAfter(base - 3 * 3_600_000, { ...RIYADH, offsetMinutes: 15 });
    expect(before.alarmMs).toBe(base - 20 * 60_000);
    expect(after.alarmMs).toBe(base + 15 * 60_000);
    expect(before.fajrMs).toBe(base);
  });

  it("returns tomorrow's alarm once today's has passed", () => {
    const today = fajrOn({ year: 2026, month: 10, day: 24 }, RIYADH);
    const tomorrow = fajrOn({ year: 2026, month: 10, day: 25 }, RIYADH);
    const next = nextAlarmAfter(today + 1, RIYADH);
    expect(next.alarmMs).toBe(tomorrow);
    expect(next.date).toBe("2026-10-25");
  });

  it("returns today's alarm when now is just before it", () => {
    const today = fajrOn({ year: 2026, month: 10, day: 24 }, RIYADH);
    const next = nextAlarmAfter(today - 60_000, RIYADH);
    expect(next.alarmMs).toBe(today);
    expect(next.date).toBe("2026-10-24");
  });

  it("handles a negative offset that crosses midnight in the city zone", () => {
    // Build a zone/date where Fajr is early and offset pushes the alarm to the
    // previous calendar day: Reykjavik in late May has Fajr around 01:xx.
    const REYK: FajrSettings = { lat: 64.1466, lng: -21.9426, timezone: "Atlantic/Reykjavik", method: "MuslimWorldLeague", offsetMinutes: -60 };
    const fajr = fajrOn({ year: 2026, month: 5, day: 20 }, REYK);
    const fajrLocal = formatTimeInTz(fajr, REYK.timezone);
    // Only meaningful if Fajr is before 01:00 local; otherwise just assert monotonicity.
    const now = fajr - 90 * 60_000;
    const next = nextAlarmAfter(now, REYK);
    expect(next.alarmMs).toBe(fajr - 60 * 60_000);
    if (minutesOf(fajrLocal) < 60) {
      expect(next.date).toBe("2026-05-20"); // date is the Fajr day, not the alarm day
    }
  });

  it("formats the alarm in the Eight Sleep account's zone, not the city's", () => {
    // A user in Riyadh whose Eight Sleep profile is still set to London time.
    const fajr = fajrOn({ year: 2026, month: 10, day: 24 }, RIYADH);
    expect(hhmm(fajr, "Asia/Riyadh")).toBe("04:37");
    expect(hhmm(fajr, "Europe/London")).toBe("02:37"); // BST (+1) vs +3
    expect(formatTimeInTz(fajr, "Europe/London")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("DST switch day: the hourly scheduler still moves forward by about a day", () => {
    const before = fajrOn({ year: 2026, month: 3, day: 28 }, LONDON);
    const after = nextAlarmAfter(before + 1, LONDON);
    const diffHours = (after.alarmMs - before) / 3_600_000;
    // Fajr shifts by solar motion only (~3 min); the clock jump must not create a 23h/25h error.
    expect(diffHours).toBeGreaterThan(23.5);
    expect(diffHours).toBeLessThan(24.5);
    expect(after.date).toBe("2026-03-29");
  });
});

describe("previewAlarms", () => {
  it("returns 7 consecutive days starting with the next alarm", () => {
    const today = fajrOn({ year: 2026, month: 10, day: 24 }, RIYADH);
    const list = previewAlarms(today + 1, RIYADH, 7);
    expect(list).toHaveLength(7);
    expect(list.map((e) => e.date)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    for (let i = 1; i < list.length; i++) expect(list[i]!.alarmMs).toBeGreaterThan(list[i - 1]!.alarmMs);
  });
});

describe("date helpers", () => {
  it("localDateOf respects the zone across the date line", () => {
    const ms = Date.UTC(2026, 0, 1, 23, 30); // 2026-01-01T23:30Z
    expect(formatLocalDate(localDateOf(ms, "Pacific/Auckland"))).toBe("2026-01-02");
    expect(formatLocalDate(localDateOf(ms, "America/Los_Angeles"))).toBe("2026-01-01");
  });
  it("addDays rolls over months and leap years", () => {
    expect(formatLocalDate(addDays({ year: 2028, month: 2, day: 28 }, 1))).toBe("2028-02-29");
    expect(formatLocalDate(addDays({ year: 2026, month: 12, day: 31 }, 1))).toBe("2027-01-01");
    expect(formatLocalDate(addDays({ year: 2026, month: 1, day: 1 }, -1))).toBe("2025-12-31");
  });
  it("validates IANA zones", () => {
    expect(isValidTimeZone("Asia/Riyadh")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("methods", () => {
  it("defaults by country", () => {
    expect(defaultMethodForCountry("SA")).toBe("UmmAlQura");
    expect(defaultMethodForCountry("ae")).toBe("Dubai");
    expect(defaultMethodForCountry("US")).toBe("NorthAmerica");
    expect(defaultMethodForCountry("GB")).toBe("MoonsightingCommittee");
    expect(defaultMethodForCountry("FR")).toBe("MuslimWorldLeague");
    expect(defaultMethodForCountry(undefined)).toBe("MuslimWorldLeague");
  });
  it("clamps offsets to [-60, 60] and buckets them", () => {
    expect(clampOffset(-999)).toBe(-60);
    expect(clampOffset(999)).toBe(60);
    expect(clampOffset(12.6)).toBe(13);
    expect(clampOffset(NaN)).toBe(0);
    expect(offsetBucket(-45)).toBe("-60..-31");
    expect(offsetBucket(-1)).toBe("-30..-1");
    expect(offsetBucket(0)).toBe("0");
    expect(offsetBucket(30)).toBe("1..30");
    expect(offsetBucket(31)).toBe("31..60");
  });
});
