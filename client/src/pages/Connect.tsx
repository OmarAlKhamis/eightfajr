import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useI18n } from "@/i18n";
import { ApiError, useConnect, useMe } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export function Connect() {
  const { t } = useI18n();
  const { data: me, isLoading } = useMe();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const connect = useConnect();

  if (isLoading) return <Layout>{t.common.loading}</Layout>;
  if (me === null) return <Redirect to="/signin" />;
  if (!me) return null;

  const reconnect = me.connection && me.connection.status !== "connected";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    connect.mutate(
      { email: email.trim(), password },
      {
        onSuccess: () => {
          setPassword(""); // drop it from memory as soon as we can
          navigate(me.settings ? "/settings" : "/settings?first=1");
        },
        onSettled: () => setPassword(""),
      },
    );
  };

  const errCode = connect.error instanceof ApiError ? connect.error.code : null;
  const errMsg = errCode ? (t.connect.errors as Record<string, string>)[errCode] ?? t.connect.errors.UNKNOWN : null;

  return (
    <Layout>
      <div className="max-w-md mx-auto py-6 space-y-4">
        <Card title={reconnect ? t.connect.reconnectTitle : t.connect.title}>
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted leading-relaxed">{reconnect ? t.connect.reconnectBody : t.connect.body}</p>
            <Field label={t.connect.email} htmlFor="e8email">
              <Input id="e8email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
            </Field>
            <Field label={t.connect.password} htmlFor="e8pw">
              <Input id="e8pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
            </Field>
            {errMsg && !connect.isPending && <Alert tone="bad">{errMsg}</Alert>}
            <Button type="submit" className="w-full" loading={connect.isPending}>
              {connect.isPending ? t.connect.connecting : t.connect.submit}
            </Button>
          </form>
        </Card>
        <ul className="space-y-2 px-1">
          {t.connect.trust.map((line) => (
            <li key={line} className="flex items-center gap-2 text-sm text-muted">
              <ShieldCheck className="size-4 text-ok-500 shrink-0" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </Layout>
  );
}
