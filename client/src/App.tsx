import { useEffect } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { useI18n } from "@/i18n";
import { useConfig } from "@/lib/api";
import { initAnalytics, track } from "@/lib/analytics";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui";
import { Admin } from "@/pages/Admin";
import { Connect } from "@/pages/Connect";
import { Landing } from "@/pages/Landing";
import { Privacy } from "@/pages/Privacy";
import { Settings } from "@/pages/Settings";
import { SignIn } from "@/pages/SignIn";
import { Verify } from "@/pages/Verify";

function NotFound() {
  const { t } = useI18n();
  return (
    <Layout>
      <div className="py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">{t.notFound.title}</h1>
        <Link href="/">
          <Button variant="secondary">{t.notFound.home}</Button>
        </Link>
      </div>
    </Layout>
  );
}

function AnalyticsBoot() {
  const { data: cfg } = useConfig();
  const { locale } = useI18n();
  const [path] = useLocation();
  useEffect(() => {
    initAnalytics(cfg);
  }, [cfg]);
  useEffect(() => {
    // One coarse "visit" per route; no referrer, no query string.
    track("visit", { path: path.split("?")[0] ?? "/", locale });
  }, [path, locale]);
  return null;
}

export function App() {
  return (
    <>
      <AnalyticsBoot />
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/signin" component={SignIn} />
        <Route path="/auth/verify" component={Verify} />
        <Route path="/connect" component={Connect} />
        <Route path="/settings" component={Settings} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}
