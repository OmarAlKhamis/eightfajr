import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useVerifyToken, type Me } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { Alert, Button, Card, Spinner } from "@/components/ui";

// The emailed link opens this SPA route; we POST the token from here so that
// link-scanning mail servers (which only GET) cannot consume it.
export function Verify() {
  const { t, setLocale } = useI18n();
  const search = useSearch();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const verify = useVerifyToken();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(search);
    const token = params.get("token") ?? "";
    const locale = params.get("locale") === "en" ? "en" : "ar";
    setLocale(locale);
    verify.mutate(
      { token, locale },
      {
        onSuccess: async () => {
          const me = await qc.fetchQuery<Me | null>({ queryKey: ["me"] });
          navigate(!me?.connection ? "/connect" : !me.settings ? "/settings?first=1" : "/settings", { replace: true });
        },
        onError: () => setFailed(true),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Layout>
      <div className="max-w-md mx-auto py-10">
        <Card>
          {failed ? (
            <div className="space-y-4">
              <Alert tone="bad">
                {t.verify.failed} {t.signin.errors.expired}
              </Alert>
              <Link href="/signin">
                <Button className="w-full">{t.verify.again}</Button>
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Spinner />
              <span>{t.verify.title}</span>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
}
