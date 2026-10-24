import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ar } from "./ar";
import { en, type Dict } from "./en";

export type Locale = "ar" | "en";
const dicts: Record<Locale, Dict> = { ar, en };
const STORAGE_KEY = "fajr.locale";

function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ar" || saved === "en") return saved;
  } catch {
    /* private mode */
  }
  return "ar"; // Arabic is the default experience.
}

interface I18nValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: Dict;
  setLocale: (l: Locale) => void;
  /** Tiny interpolation: fmt("Hello {name}", {name: "x"}). */
  fmt: (template: string, vars: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitial);
  const dir = locale === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);
  const fmt = useCallback(
    (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")),
    [],
  );

  const value = useMemo<I18nValue>(() => ({ locale, dir, t: dicts[locale], setLocale, fmt }), [locale, dir, setLocale, fmt]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n outside provider");
  return v;
}
