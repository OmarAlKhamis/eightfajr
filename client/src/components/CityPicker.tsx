import { LocateFixed, MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cityLabel, nearestCity, searchCities, type City, type SearchIndexEntry } from "@shared/cities";
import { useI18n } from "@/i18n";
import { loadCityIndex } from "@/lib/cities";
import { countryName } from "@/lib/format";
import { Button, Input } from "./ui";

export function CityPicker({ value, onChange }: { value: City | null; onChange: (c: City) => void }) {
  const { t, locale } = useI18n();
  const [index, setIndex] = useState<SearchIndexEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCityIndex()
      .then(setIndex)
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    if (!index) return;
    const h = setTimeout(() => setResults(searchCities(index, q, 8)), 120);
    return () => clearTimeout(h);
  }, [q, index]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (c: City) => {
    onChange(c);
    setQ("");
    setOpen(false);
  };

  const locate = () => {
    if (!navigator.geolocation || !index) {
      setLocError(true);
      return;
    }
    setLocating(true);
    setLocError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const c = nearestCity(index, pos.coords.latitude, pos.coords.longitude);
        if (c) pick(c);
        else setLocError(true);
      },
      () => {
        setLocating(false);
        setLocError(true);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  return (
    <div className="space-y-2" ref={boxRef}>
      {value && (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-app px-3 py-2.5">
          <MapPin className="size-4 text-accent shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold truncate">{cityLabel(value, locale)}</div>
            <div className="text-xs text-muted truncate">
              {[value.admin1, countryName(value.countryCode, locale)].filter(Boolean).join(" · ")} · <span className="ltr-num">{value.timezone}</span>
            </div>
          </div>
        </div>
      )}
      <div className="relative">
        <Search className="absolute top-1/2 -translate-y-1/2 inset-s-3 size-4 text-muted pointer-events-none" style={{ insetInlineStart: 12 }} />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={index ? t.settings.citySearch : loadError ? t.common.error : t.settings.loadingCities}
          disabled={!index}
          style={{ paddingInlineStart: 36 }}
          autoComplete="off"
          aria-label={t.settings.city}
        />
        {open && q.length >= 2 && (
          <ul className="absolute z-10 mt-1 w-full max-h-72 overflow-auto rounded-xl border border-line bg-elev shadow-lg">
            {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">{t.settings.cityNoResults}</li>}
            {results.map((c) => (
              <li key={`${c.name}-${c.lat}-${c.lng}`}>
                <button type="button" onClick={() => pick(c)} className="w-full text-start px-3 py-2 hover:bg-sand-100 dark:hover:bg-night-800">
                  <div className="font-semibold">
                    {cityLabel(c, locale)}
                    {locale === "ar" && c.nameAr && <span className="text-muted font-normal text-xs ms-2 ltr-num">{c.name}</span>}
                  </div>
                  <div className="text-xs text-muted">{[c.admin1, countryName(c.countryCode, locale)].filter(Boolean).join(" · ")}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={locate} loading={locating} disabled={!index}>
          <LocateFixed className="size-4" />
          {locating ? t.settings.locating : t.settings.useLocation}
        </Button>
        {locError && <span className="text-xs text-bad-500">{t.settings.locationDenied}</span>}
      </div>
    </div>
  );
}
