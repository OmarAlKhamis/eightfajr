import { ArrowDown, BellRing, Lock, MapPin, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { useI18n } from "@/i18n";
import { useMe, usePreview } from "@/lib/api";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { Layout } from "@/components/Layout";
import { PreviewTable } from "@/components/Preview";
import { Button, Card } from "@/components/ui";

const MAKKAH = { lat: 21.4225, lng: 39.8262, timezone: "Asia/Riyadh", method: "UmmAlQura" as const, offsetMinutes: 0 };
const ICONS = [Lock, BellRing, MapPin, RefreshCw];

export function Landing() {
  const { t, fmt, locale } = useI18n();
  const { data: me } = useMe();
  const preview = usePreview(MAKKAH, 7);

  return (
    <Layout wide>
      <section className="py-8 sm:py-14 grid gap-8 lg:grid-cols-2 lg:items-center">
        <div className="space-y-5">
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight">{t.landing.heroTitle}</h1>
          <p className="text-[17px] leading-relaxed text-muted">{t.landing.heroBody}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={me ? "/settings" : "/signin"}>
              <Button size="lg" variant="accent">
                {t.landing.cta}
              </Button>
            </Link>
            <a href="#how">
              <Button size="lg" variant="secondary">
                {t.landing.ctaSecondary}
                <ArrowDown className="size-4" />
              </Button>
            </a>
          </div>
          <p className="text-xs text-muted">{t.common.free} · {t.landing.faq[0]!.q}</p>
        </div>
        <Card title={fmt(t.landing.exampleTitle, { city: locale === "ar" ? "مكة المكرمة" : "Makkah" })} action={<span className="text-xs text-muted">{t.landing.exampleMethod}</span>}>
          <PreviewTable entries={preview.data?.entries} timezone={MAKKAH.timezone} loading={preview.isLoading} />
        </Card>
      </section>

      <section id="how" className="py-8 space-y-5">
        <h2 className="text-2xl font-bold">{t.landing.howTitle}</h2>
        <ol className="grid gap-4 sm:grid-cols-2">
          {t.landing.how.map((step, i) => {
            const Icon = ICONS[i]!;
            return (
              <li key={step.t} className="bg-elev border border-line rounded-2xl p-5 flex gap-4">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-bold">
                    <span className="text-muted me-1">{i + 1}.</span> {step.t}
                  </h3>
                  <p className="text-sm text-muted leading-relaxed mt-1">{step.d}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="py-8 space-y-5">
        <h2 className="text-2xl font-bold">{t.landing.faqTitle}</h2>
        <div className="space-y-3">
          {t.landing.faq.map((item) => (
            <details key={item.q} className="group bg-elev border border-line rounded-2xl px-5 py-4">
              <summary className="cursor-pointer font-semibold list-none flex justify-between items-center gap-3">
                {item.q}
                <span className="text-muted transition group-open:rotate-180">⌄</span>
              </summary>
              <p className="text-sm text-muted leading-relaxed mt-3">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="py-6 max-w-md mx-auto w-full">
        <FeedbackWidget page="landing" />
      </section>
    </Layout>
  );
}
