import { useI18n } from "@/i18n";
import type { PreviewEntry } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/format";
import { Spinner } from "./ui";

export function PreviewTable({ entries, timezone, podTimezone, loading }: { entries: PreviewEntry[] | undefined; timezone: string; podTimezone?: string | null; loading?: boolean }) {
  const { t, locale } = useI18n();
  const showPod = !!podTimezone && podTimezone !== timezone;
  if (loading && !entries) return <Spinner />;
  if (!entries) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-sand-100 dark:bg-night-800 text-muted text-xs">
          <tr>
            <th className="text-start font-semibold px-3 py-2">{locale === "ar" ? "اليوم" : "Day"}</th>
            <th className="text-start font-semibold px-3 py-2">{t.settings.previewFajr}</th>
            <th className="text-start font-semibold px-3 py-2">{t.settings.previewAlarm}</th>
            {showPod && <th className="text-start font-semibold px-3 py-2">{t.common.podTime}</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.date} className={i % 2 ? "bg-app/60" : ""}>
              <td className="px-3 py-2">{fmtDate(e.fajrMs, timezone, locale)}</td>
              <td className="px-3 py-2 ltr-num">{fmtTime(e.fajrMs, timezone, locale)}</td>
              <td className="px-3 py-2 font-semibold ltr-num">{fmtTime(e.alarmMs, timezone, locale)}</td>
              {showPod && <td className="px-3 py-2 ltr-num text-muted">{fmtTime(e.alarmMs, podTimezone!, locale)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
