import { buildIndex, type CityRow, type SearchIndexEntry } from "@shared/cities";

// Lazy-loads the bundled GeoNames dataset once per session (≈2.8 MB raw, gzip on the wire).
let promise: Promise<SearchIndexEntry[]> | null = null;

export function loadCityIndex(): Promise<SearchIndexEntry[]> {
  if (!promise) {
    promise = fetch("/data/cities.json")
      .then((r) => {
        if (!r.ok) throw new Error(`cities.json ${r.status}`);
        return r.json() as Promise<{ rows: CityRow[] }>;
      })
      .then((j) => buildIndex(j.rows))
      .catch((e) => {
        promise = null;
        throw e;
      });
  }
  return promise;
}
