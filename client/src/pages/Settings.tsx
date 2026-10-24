import { AlertTriangle, Bell, Check, Pause, Play, RefreshCw, Unlink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Redirect, useSearch } from "wouter";
import type { City } from "@shared/cities";
import { METHOD_KEYS, defaultMethodForCountry, type MethodKey } from "@shared/methods";
import { useI18n } from "@/i18n";
import { useDisconnect, useMe, usePause, usePreview, useSaveSettings, useSyncNow, type Me, type SettingsInput, type SyncOutcome } from "@/lib/api";
import { fmtDate, fmtRelative, fmtTime } from "@/lib/format";
import { CityPicker } from "@/components/CityPicker";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { Layout } from "@/components/Layout";
import { PreviewTable } from "@/components/Preview";
import { Alert, Badge, Button, Card, Field, Select, Toggle } from "@/components/ui";

type Form = SettingsInput;

function settingsToForm(s: NonNullable<Me["settings"]>): Form {
  return {
    cityName: s.cityName,
    countryCode: s.countryCode,
    admin1: s.admin1,
    lat: s.lat,
    lng: s.lng,
    timezone: s.timezone,
    method: s.method,
    offsetMinutes: s.offsetMinutes,
    vibrationEnabled: s.vibrationEnabled,
    vibrationPower: s.vibrationPower,
    vibrationPattern: s.vibrationPattern ?? "RISE",
    thermalEnabled: s.thermalEnabled,
    thermalLevel: s.thermalLevel,
    smartWake: s.smartWake ?? false,
  };
}

function formToCity(f: Form): City {
  return { name: f.cityName, ascii: f.cityName, nameAr: "", countryCode: f.countryCode, admin1: f.admin1 ?? "", lat: f.lat, lng: f.lng, timezone: f.timezone, population: 0 };
}

export function Settings() {
  const { t, fmt, locale } = useI18n();
  const { data: me, isLoading } = useMe();
  const search = useSearch();
  const first = new URLSearchParams(search).get("first") === "1";

  if (isLoading) return <Layout>{t.common.loading}</Layout>;
  if (me === null) return <Redirect to="/signin" />;
  if (!me) return null;
  return <SettingsInner me={me} first={first} key={me.settings?.updatedAt ?? "new"} t={t} fmt={fmt} locale={locale} />;
}

function SettingsInner({ me, first, t, fmt, locale }: { me: Me; first: boolean; t: ReturnType<typeof useI18n>["t"]; fmt: ReturnType<typeof useI18n>["fmt"]; locale: "ar" | "en" }) {
  const [form, setForm] = useState<Form | null>(me.settings ? settingsToForm(me.settings) : null);
  const [city, setCity] = useState<City | null>(me.settings ? formToCity(settingsToForm(me.settings)) : null);
  const [methodTouched, setMethodTouched] = useState(!!me.settings);
  const [flash, setFlash] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const save = useSaveSettings();
  const pause = usePause();
  const syncNow = useSyncNow();
  const disconnect = useDisconnect();

  const previewParams = form ? { lat: form.lat, lng: form.lng, timezone: form.timezone, method: form.method, offsetMinutes: form.offsetMinutes } : null;
  const preview = usePreview(previewParams, 7);
  const podTz = me.connection?.eightTimezone ?? null;
  const dirty = useMemo(() => !me.settings || JSON.stringify(settingsToForm(me.settings)) !== JSON.stringify(form), [me.settings, form]);

  useEffect(() => {
    if (!flash) return;
    const h = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(h);
  }, [flash]);

  const onCity = (c: City) => {
    setCity(c);
    setForm((f) => ({
      ...(f ?? {
        offsetMinutes: 0,
        vibrationEnabled: true,
        vibrationPower: 50 as const,
        vibrationPattern: "RISE" as const,
        thermalEnabled: true,
        thermalLevel: 0,
        smartWake: false,
        method: "MuslimWorldLeague" as MethodKey,
      }),
      cityName: c.name,
      countryCode: c.countryCode,
      admin1: c.admin1 || null,
      lat: c.lat,
      lng: c.lng,
      timezone: c.timezone,
      method: methodTouched && f ? f.method : defaultMethodForCountry(c.countryCode),
    }));
  };

  const describeSync = (s: SyncOutcome | null | undefined): string | null => {
    if (!s) return null;
    if (s.result === "failed") return (t.settings.errors as Record<string, string>)[s.errorCode ?? "UNKNOWN"] ?? t.settings.errors.UNKNOWN;
    return t.settings.results[s.result];
  };

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    save.mutate(form, {
      onSuccess: (r) => {
        if (!me.connection) setFlash({ tone: "warn", text: t.settings.savedPending });
        else if (r.sync?.result === "failed") setFlash({ tone: "bad", text: `${t.common.save}: ${describeSync(r.sync)}` });
        else setFlash({ tone: "ok", text: t.settings.saved });
      },
      onError: () => setFlash({ tone: "bad", text: t.common.error }),
    });
  };

  const offsetLabel = (n: number) => (n === 0 ? t.common.atFajr : n < 0 ? fmt(t.common.beforeFajr, { n: -n }) : fmt(t.common.afterFajr, { n }));

  const conn = me.connection;
  const connTone = !conn ? "neutral" : conn.status === "connected" ? "ok" : "bad";
  const connText = !conn ? t.settings.connection.none : t.settings.connection[conn.status];
  const paused = me.settings?.paused ?? false;
  const lastSync = me.lastSync;

  return (
    <Layout>
      <div className="space-y-5">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{t.settings.title}</h1>
          {me.settings && conn && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => syncNow.mutate(undefined, { onSuccess: (r) => setFlash({ tone: r.ok ? "ok" : "bad", text: describeSync(r.sync) ?? "" }) })} loading={syncNow.isPending}>
                <RefreshCw className="size-4" />
                {t.settings.syncNow}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => pause.mutate(!paused, { onSuccess: (r) => setFlash({ tone: "ok", text: describeSync(r.sync) ?? "" }) })} loading={pause.isPending}>
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                {paused ? t.settings.resume : t.settings.pause}
              </Button>
            </div>
          )}
        </header>

        {first && !me.settings && <Alert tone="warn">{t.settings.firstTime}</Alert>}
        {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}

        {/* Status */}
        <Card title={t.settings.statusTitle}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={connTone}>{connText}</Badge>
              {conn && conn.status !== "connected" && (
                <Link href="/connect" className="text-sm font-semibold underline text-accent">
                  {t.settings.connection.reconnect}
                </Link>
              )}
              {!conn && (
                <Link href="/connect" className="text-sm font-semibold underline text-accent">
                  {t.settings.connection.connect}
                </Link>
              )}
            </div>
            {paused && (
              <Alert tone="warn">
                <Pause className="inline size-4 me-1" />
                {t.settings.paused}
              </Alert>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-app border border-line p-4">
                <div className="text-xs text-muted flex items-center gap-1">
                  <Bell className="size-3.5" />
                  {t.settings.nextAlarm}
                </div>
                {me.nextAlarm && me.settings ? (
                  <>
                    <div className="text-2xl font-bold ltr-num mt-1">{fmtTime(me.nextAlarm.alarmMs, me.settings.timezone, locale)}</div>
                    <div className="text-sm text-muted">
                      {fmtDate(me.nextAlarm.alarmMs, me.settings.timezone, locale)} · {me.settings.cityName}
                    </div>
                    {podTz && podTz !== me.settings.timezone && (
                      <div className="text-xs text-muted mt-1 ltr-num">
                        = {fmtTime(me.nextAlarm.alarmMs, podTz, locale)} ({podTz})
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-lg font-semibold mt-1 text-muted">{t.settings.nextAlarmNone}</div>
                )}
              </div>
              <div className="rounded-xl bg-app border border-line p-4">
                <div className="text-xs text-muted flex items-center gap-1">
                  <RefreshCw className="size-3.5" />
                  {t.settings.lastSync}
                </div>
                {lastSync ? (
                  <>
                    <div className="text-lg font-bold mt-1">{fmtRelative(lastSync.startedAt, locale)}</div>
                    <div className="text-sm flex items-center gap-1.5">
                      {lastSync.result === "failed" ? <AlertTriangle className="size-4 text-bad-500" /> : <Check className="size-4 text-ok-500" />}
                      <span className={lastSync.result === "failed" ? "text-bad-500" : "text-muted"}>
                        {lastSync.result === "failed"
                          ? (t.settings.errors as Record<string, string>)[lastSync.errorCode ?? "UNKNOWN"] ?? t.settings.errors.UNKNOWN
                          : t.settings.results[lastSync.result]}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-lg font-semibold mt-1 text-muted">{t.settings.never}</div>
                )}
              </div>
            </div>
            {podTz && me.settings && podTz !== me.settings.timezone && (
              <p className="text-xs text-muted">
                <AlertTriangle className="inline size-3.5 me-1 text-warn-500" />
                {fmt(t.settings.tzMismatch, { podTz })}
              </p>
            )}
          </div>
        </Card>

        {/* Settings form */}
        <form onSubmit={onSave}>
          <Card title={t.nav.settings}>
            <div className="space-y-6">
              <Field label={t.settings.city}>
                <CityPicker value={city} onChange={onCity} />
              </Field>

              {form && (
                <>
                  <Field label={t.settings.method} hint={t.settings.methodHint} htmlFor="method">
                    <Select
                      id="method"
                      value={form.method}
                      onChange={(e) => {
                        setMethodTouched(true);
                        setForm({ ...form, method: e.target.value as MethodKey });
                      }}
                    >
                      {METHOD_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {t.methods[k]}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label={`${t.settings.offset}: ${offsetLabel(form.offsetMinutes)}`} htmlFor="offset">
                    <input
                      id="offset"
                      type="range"
                      min={-60}
                      max={60}
                      step={1}
                      value={form.offsetMinutes}
                      onChange={(e) => setForm({ ...form, offsetMinutes: Number(e.target.value) })}
                      className="w-full"
                      dir="ltr"
                    />
                    <div className="flex justify-between text-xs text-muted ltr-num" dir="ltr">
                      <span>-60</span>
                      <span>0</span>
                      <span>+60</span>
                    </div>
                  </Field>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div className="space-y-3">
                      <Toggle id="vib" checked={form.vibrationEnabled} onChange={(v) => setForm({ ...form, vibrationEnabled: v })} label={<strong>{t.settings.vibration}</strong>} />
                      {form.vibrationEnabled && (
                        <>
                          <div className="text-xs text-muted">{t.settings.vibrationPower}</div>
                          <div className="flex gap-2">
                            {([20, 50, 100] as const).map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setForm({ ...form, vibrationPower: p })}
                                className={`flex-1 h-10 rounded-xl border text-sm font-semibold ${form.vibrationPower === p ? "bg-primary border-transparent" : "border-line bg-app"}`}
                              >
                                {t.settings.power[p]}
                              </button>
                            ))}
                          </div>
                          <div className="text-xs text-muted">{t.settings.vibrationPattern}</div>
                          <div className="flex gap-2">
                            {(["RISE", "INTENSE"] as const).map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setForm({ ...form, vibrationPattern: p })}
                                className={`flex-1 h-10 rounded-xl border text-sm font-semibold ${form.vibrationPattern === p ? "bg-primary border-transparent" : "border-line bg-app"}`}
                              >
                                {t.settings.patterns[p]}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="space-y-3">
                      <Toggle id="thermal" checked={form.thermalEnabled} onChange={(v) => setForm({ ...form, thermalEnabled: v })} label={<strong>{t.settings.thermal}</strong>} />
                      {form.thermalEnabled && (
                        <div>
                          <div className="flex justify-between text-xs text-muted">
                            <span>{t.settings.thermalLevel}</span>
                            <span className="ltr-num font-semibold">{form.thermalLevel > 0 ? `+${form.thermalLevel}` : form.thermalLevel}</span>
                          </div>
                          <input type="range" min={-100} max={100} step={10} value={form.thermalLevel} onChange={(e) => setForm({ ...form, thermalLevel: Number(e.target.value) })} className="w-full" dir="ltr" />
                          <p className="text-xs text-muted">{t.settings.thermalHint}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Toggle id="smart" checked={form.smartWake} onChange={(v) => setForm({ ...form, smartWake: v })} label={<strong>{t.settings.smartWake}</strong>} />
                    <p className="text-xs text-muted leading-relaxed">{t.settings.smartWakeHint}</p>
                  </div>

                  <Button type="submit" className="w-full" size="lg" loading={save.isPending} disabled={!dirty && !!me.settings}>
                    {save.isPending ? t.common.saving : t.common.save}
                  </Button>
                </>
              )}
            </div>
          </Card>
        </form>

        {form && (
          <Card title={t.settings.previewTitle}>
            <PreviewTable entries={preview.data?.entries} timezone={form.timezone} podTimezone={podTz} loading={preview.isLoading} />
          </Card>
        )}

        <FeedbackWidget page="settings" />

        {conn && (
          <Card title={t.settings.dangerTitle} className="border-bad-500/30">
            <p className="text-sm text-muted leading-relaxed mb-4">{t.settings.dangerBody}</p>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm(t.settings.disconnectConfirm)) disconnect.mutate(undefined, { onSuccess: () => setFlash({ tone: "ok", text: t.settings.disconnected }) });
              }}
              loading={disconnect.isPending}
            >
              <Unlink className="size-4" />
              {t.settings.disconnect}
            </Button>
          </Card>
        )}
      </div>
    </Layout>
  );
}
