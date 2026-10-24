import { useState } from "react";
import { Redirect } from "wouter";
import { useI18n } from "@/i18n";
import { useAdminStats, useMe } from "@/lib/api";
import { countryName, fmtDateTime } from "@/lib/format";
import { Layout } from "@/components/Layout";
import { Card, Spinner } from "@/components/ui";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-app border border-line p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-bold ltr-num">{value}</div>
    </div>
  );
}

function List({ title, rows, label }: { title: string; rows: { key: string; n: number }[]; label?: (k: string) => string }) {
  const { t } = useI18n();
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t.admin.noData}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-3">
              <span>{label ? label(r.key) : r.key}</span>
              <span className="font-semibold ltr-num">{r.n}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Admin() {
  const { t, fmt, locale } = useI18n();
  const { data: me, isLoading } = useMe();
  const [days, setDays] = useState(30);
  const stats = useAdminStats(days);

  if (isLoading) return <Layout>{t.common.loading}</Layout>;
  if (me === null) return <Redirect to="/signin" />;
  if (!me?.user.isAdmin) return <Redirect to="/" />;

  const s = stats.data;
  const total = s?.syncsByResult.reduce((a, r) => a + r.n, 0) ?? 0;
  const failed = s?.syncsByResult.find((r) => r.result === "failed")?.n ?? 0;
  const writes = s?.syncsByResult.filter((r) => ["updated", "created", "recreated"].includes(r.result)).reduce((a, r) => a + r.n, 0) ?? 0;
  const days_ = Array.from(new Set(s?.syncsPerDay.map((r) => r.day) ?? [])).sort().reverse();
  const results = ["updated", "created", "recreated", "skipped", "paused", "failed"] as const;

  return (
    <Layout wide>
      <div className="space-y-5">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t.admin.title}</h1>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-app px-2 text-sm">
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {d}d
              </option>
            ))}
          </select>
        </header>
        {!s ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label={t.admin.users} value={s.users} />
              <Stat label={t.admin.connected} value={s.connected} />
              <Stat label={t.admin.attention} value={s.needsAttention} />
              <Stat label={t.admin.paused} value={s.paused} />
              <Stat label={fmt(t.admin.syncs, { d: s.days })} value={total} />
              <Stat label={locale === "ar" ? "كتابات على السرير" : "Pod writes"} value={writes} />
              <Stat label={t.admin.failRate} value={total ? `${((failed / total) * 100).toFixed(1)}%` : "–"} />
              <Stat label={t.admin.feedback} value={`👍 ${s.feedback.up} · 👎 ${s.feedback.down}`} />
            </div>

            <Card title={t.admin.perDay}>
              {days_.length === 0 ? (
                <p className="text-sm text-muted">{t.admin.noData}</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th className="text-start px-2 py-1">{locale === "ar" ? "اليوم" : "Day"}</th>
                        {results.map((r) => (
                          <th key={r} className="text-start px-2 py-1">
                            {r}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {days_.map((d) => (
                        <tr key={d} className="border-t border-line">
                          <td className="px-2 py-1 ltr-num">{d}</td>
                          {results.map((r) => (
                            <td key={r} className="px-2 py-1 ltr-num">
                              {s.syncsPerDay.find((x) => x.day === d && x.result === r)?.n ?? 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid sm:grid-cols-3 gap-4">
              <List title={t.admin.countries} rows={s.topCountries} label={(k) => `${countryName(k, locale)} (${k})`} />
              <List title={t.admin.methods} rows={s.topMethods} label={(k) => (t.methods as Record<string, string>)[k] ?? k} />
              <List title={t.admin.errors} rows={s.errorCodes} />
            </div>

            <Card title={t.admin.feedback}>
              {s.feedback.recent.length === 0 ? (
                <p className="text-sm text-muted">{t.admin.noData}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {s.feedback.recent.map((f) => (
                    <li key={f.id} className="py-2 text-sm flex gap-3">
                      <span>{f.rating === "up" ? "👍" : "👎"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted ltr-num">
                          {fmtDateTime(f.createdAt, "UTC", locale)} UTC · {f.page} · {f.locale}
                        </div>
                        {f.comment && <p className="whitespace-pre-wrap break-words">{f.comment}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
