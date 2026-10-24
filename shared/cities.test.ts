import { describe, expect, it } from "vitest";
import { buildIndex, nearestCity, normalize, searchCities, type CityRow } from "./cities";

const rows: CityRow[] = [
  ["Riyadh", "", "الرياض", "SA", "Riyadh Region", 24.6877, 46.7219, "Asia/Riyadh", 4205961],
  ["Jeddah", "", "جدة", "SA", "Mecca Region", 21.5424, 39.1979, "Asia/Riyadh", 2867446],
  ["Mecca", "", "مكة المكرمة", "SA", "Mecca Region", 21.4267, 39.8261, "Asia/Riyadh", 1323624],
  ["Dubai", "", "دبي", "AE", "Dubai", 25.0657, 55.1713, "Asia/Dubai", 3478300],
  ["Al Kharj", "", "الخرج", "SA", "Riyadh Region", 24.1554, 47.3346, "Asia/Riyadh", 425300],
  ["Ad Diriyah", "", "الدرعية", "SA", "Riyadh Region", 24.7336, 46.5756, "Asia/Riyadh", 43269],
  ["Zürich", "Zurich", "زيورخ", "CH", "Zurich", 47.3667, 8.55, "Europe/Zurich", 341730],
];
const index = buildIndex(rows);

describe("normalize", () => {
  it("unifies Arabic variants and strips tashkeel", () => {
    expect(normalize("مَكَّة")).toBe("مكه");
    expect(normalize("الرِّيَاض")).toBe("الرياض");
    expect(normalize("أبها")).toBe("ابها");
    expect(normalize("Zürich")).toBe("zurich");
  });
});

describe("searchCities", () => {
  it("matches Latin, ASCII and Arabic names, prefix first, by population", () => {
    expect(searchCities(index, "riy").map((c) => c.name)).toEqual(["Riyadh", "Ad Diriyah"]); // prefix before substring
    expect(searchCities(index, "zur").map((c) => c.name)).toEqual(["Zürich"]);
    expect(searchCities(index, "الري").map((c) => c.name)).toEqual(["Riyadh"]);
    expect(searchCities(index, "مكه").map((c) => c.name)).toEqual(["Mecca"]);
    expect(searchCities(index, "a")).toEqual([]); // too short
  });
});

describe("nearestCity", () => {
  it("prefers the big city nearby over a tiny suburb when distances are close", () => {
    // A point between Riyadh (4.2M) and Ad Diriyah (43k), slightly closer to Diriyah.
    expect(nearestCity(index, 24.72, 46.62)?.name).toBe("Riyadh");
    expect(nearestCity(index, 21.43, 39.83)?.name).toBe("Mecca");
    expect(nearestCity(index, 0, 0)).toBeNull();
  });
});
