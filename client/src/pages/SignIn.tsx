import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Redirect, useSearch } from "wouter";
import { useI18n } from "@/i18n";
import { ApiError, fetchDevMagicLink, useConfig, useMe, useRequestMagicLink } from "@/lib/api";
import { track } from "@/lib/analytics";
import { Layout } from "@/components/Layout";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export function SignIn() {
  const { t, fmt, locale } = useI18n();
  const { data: me, isLoading } = useMe();
  const { data: cfg } = useConfig();
  const search = useSearch();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const request = useRequestMagicLink();
  const urlError = new URLSearchParams(search).get("error");

  useEffect(() => {
    if (sentTo && cfg?.mock) fetchDevMagicLink().then((l) => l && setDevLink(l.url));
  }, [sentTo, cfg?.mock]);

  if (isLoading) return <Layout>{t.common.loading}</Layout>;
  if (me) return <Redirect to="/settings" />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    request.mutate(
      { email: email.trim(), locale },
      {
        onSuccess: () => {
          setSentTo(email.trim());
          track("signup_requested", { locale });
        },
      },
    );
  };

  const errKey = request.error instanceof ApiError ? request.error.code : urlError;
  const errMsg = errKey ? (t.signin.errors as Record<string, string>)[errKey] ?? t.common.error : null;

  return (
    <Layout>
      <div className="max-w-md mx-auto py-6">
        <Card title={t.signin.title}>
          {sentTo ? (
            <div className="space-y-4">
              <Alert tone="ok">
                <strong className="block mb-1">{t.signin.sent}</strong>
                {fmt(t.signin.sentBody, { email: sentTo })}
              </Alert>
              {devLink && (
                <a href={devLink} className="block text-sm underline text-accent break-all" dir="ltr">
                  {t.signin.devLink} →
                </a>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-muted leading-relaxed">{t.signin.body}</p>
              <Field label={t.signin.email} htmlFor="email">
                <Input id="email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
              </Field>
              {errMsg && !request.isPending && <Alert tone="bad">{errMsg}</Alert>}
              <Button type="submit" className="w-full" loading={request.isPending}>
                <Mail className="size-4" />
                {t.signin.submit}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </Layout>
  );
}
