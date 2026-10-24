// City dataset helpers shared by the client (search / nearest) and tests.
// Rows come from client/public/data/cities.json built by script/build-cities.mjs:
//   [name, asciiName, arabicName, countryCode, admin1Name, lat, lng, timezone, population]

export type CityRow = [string, string, string, string, string, number, number, string, number];

export interface City {
  name: string;
  ascii: string;
  nameAr: string;
  countryCode: string;
  admin1: string;
  lat: number;
  lng: number;
  timezone: string;
  population: number;
}

export function rowToCity(r: CityRow): City {
  return { name: r[0], ascii: r[1] || r[0], nameAr: r[2], countryCode: r[3], admin1: r[4], lat: r[5], lng: r[6], timezone: r[7], population: r[8] };
}

// Arabic-aware normalisation: strip tashkeel/tatweel, unify alef/yaa/taa-marbuta,
// strip Latin diacritics, lower-case.
export function normalize(s: string): string {
  return s
    .normalize("NFC") // keep hamza-carrying letters composed so the maps below match
    .replace(/[ً-ْٰـ]/g, "") // tashkeel + tatweel
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ → ا
    .replace(/ة/g, "ه") // ة → ه
    .replace(/ى/g, "ي") // ى → ي
    .replace(/ؤ/g, "و") // ؤ → و
    .replace(/ئ/g, "ي") // ئ → ي
    .replace(/ڑ/g, "ر") // ڑ → ر
    .normalize("NFKD")
    .replace(/[̀-ٕͯٔ]/g, "") // Latin combining marks + stray hamzas
    .toLowerCase()
    .trim();
}

export interface SearchIndexEntry {
  city: City;
  keys: string[]; // normalised searchable strings
}

export function buildIndex(rows: CityRow[]): SearchIndexEntry[] {
  return rows.map((r) => {
    const city = rowToCity(r);
    const keys = [normalize(city.name)];
    if (city.ascii && normalize(city.ascii) !== keys[0]) keys.push(normalize(city.ascii));
    if (city.nameAr) keys.push(normalize(city.nameAr));
    return { city, keys };
  });
}

/** Prefix matches first, then substring; ties broken by population. */
export function searchCities(index: SearchIndexEntry[], query: string, limit = 8): City[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const prefix: City[] = [];
  const contains: City[] = [];
  for (const e of index) {
    let best = 0; // 2 = prefix, 1 = contains
    for (const k of e.keys) {
      if (k.startsWith(q)) {
        best = 2;
        break;
      }
      if (k.includes(q)) best = 1;
    }
    if (best === 2) prefix.push(e.city);
    else if (best === 1) contains.push(e.city);
    if (prefix.length >= limit * 4) break; // index is population-sorted
  }
  return [...prefix, ...contains].slice(0, limit);
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Nearest city, biased towards bigger places: every 10× in population is worth
 * 4 km, so a metropolis ~10 km away beats the suburb you are standing in
 * (same prayer times, a name people recognise).
 */
export function nearestCity(index: SearchIndexEntry[], lat: number, lng: number): City | null {
  let best: City | null = null;
  let bestScore = Infinity;
  for (const { city } of index) {
    if (Math.abs(city.lat - lat) > 2 || Math.abs(city.lng - lng) > 2) continue; // cheap pre-filter (~200 km)
    const km = haversineKm(lat, lng, city.lat, city.lng);
    const score = km - 4 * Math.log10(Math.max(city.population, 20_000) / 20_000);
    if (score < bestScore) {
      bestScore = score;
      best = city;
    }
  }
  return best;
}

export function cityLabel(c: City, locale: "ar" | "en"): string {
  return locale === "ar" && c.nameAr ? c.nameAr : c.name;
}
