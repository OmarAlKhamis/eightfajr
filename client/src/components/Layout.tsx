import { Languages, LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useI18n } from "@/i18n";
import { useLogout, useMe, useSetLocale } from "@/lib/api";
import { track } from "@/lib/analytics";

const THEME_KEY = "fajr.theme";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      /* ignore */
    }
    return "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  const { data: me } = useMe();
  const logout = useLogout();
  const setServerLocale = useSetLocale();
  const [theme, setTheme] = useTheme();
  const [, navigate] = useLocation();

  const switchLocale = () => {
    const next = locale === "ar" ? "en" : "ar";
    setLocale(next);
    track("language_changed", { to: next });
    if (me) setServerLocale.mutate(next);
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 backdrop-blur bg-app/85 border-b border-line">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 font-bold text-[17px]">
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-night-800 text-dawn-300" aria-hidden>
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 17h18" />
                <path d="M6 17a6 6 0 0 1 12 0" />
                <path d="M12 3v3M5 7l2 2M19 7l-2 2" />
              </svg>
            </span>
            <span>{t.app.short}</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm whitespace-nowrap">
            {me ? (
              <>
                <Link href="/settings" className="px-3 py-2 rounded-lg hover:bg-sand-100 dark:hover:bg-night-800 font-semibold">
                  {t.nav.settings}
                </Link>
                {me.user.isAdmin && (
                  <Link href="/admin" className="px-3 py-2 rounded-lg hover:bg-sand-100 dark:hover:bg-night-800 hidden sm:inline">
                    {t.nav.admin}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/") })}
                  className="p-2 rounded-lg hover:bg-sand-100 dark:hover:bg-night-800"
                  aria-label={t.nav.signout}
                  title={t.nav.signout}
                >
                  <LogOut className="size-4" />
                </button>
              </>
            ) : (
              <Link href="/signin" className="px-3 py-2 rounded-lg hover:bg-sand-100 dark:hover:bg-night-800 font-semibold">
                {t.nav.signin}
              </Link>
            )}
            <button type="button" onClick={switchLocale} className="px-2 py-2 rounded-lg hover:bg-sand-100 dark:hover:bg-night-800 inline-flex items-center gap-1" aria-label={t.nav.language}>
              <Languages className="size-4" />
              <span className="text-xs font-semibold">{t.nav.language}</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-2 rounded-lg hover:bg-sand-100 dark:hover:bg-night-800"
              aria-label={t.nav.theme}
              title={t.nav.theme}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </nav>
        </div>
      </header>
      <main className={`flex-1 mx-auto w-full px-4 py-6 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted flex flex-wrap items-center justify-between gap-3">
          <span>{t.landing.footerNote}</span>
          <span className="flex gap-4">
            <Link href="/privacy" className="hover:underline">
              {t.nav.privacy}
            </Link>
            <a href="https://github.com/OmarAlKhamis/eightfajr" className="hover:underline" rel="noopener" target="_blank">
              GitHub
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
