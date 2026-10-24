import { useI18n } from "@/i18n";
import { Layout } from "@/components/Layout";

export function Privacy() {
  const { t } = useI18n();
  return (
    <Layout>
      <article className="prose-sm max-w-none space-y-6 py-4">
        <header>
          <h1 className="text-2xl font-bold">{t.privacy.title}</h1>
          <p className="text-xs text-muted mt-1">{t.privacy.updated}</p>
        </header>
        {t.privacy.sections.map((s) => (
          <section key={s.h} className="space-y-2">
            <h2 className="text-lg font-bold">{s.h}</h2>
            <p className="text-[15px] leading-relaxed text-muted">{s.p}</p>
          </section>
        ))}
        <p className="text-xs text-muted" dir="ltr">
          Contact: omar.ab.kh@gmail.com · Source: github.com/OmarAlKhamis/fajr-eight
        </p>
      </article>
    </Layout>
  );
}
