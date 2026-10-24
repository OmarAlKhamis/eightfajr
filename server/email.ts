import type { EightErrorCode } from "@eightsleep/index";
import type { Env } from "./env";

// Outbound email via Resend's HTTP API (no SDK needed on Workers).
// - No RESEND_API_KEY (local dev, CI): nothing is sent; the magic link is logged
//   to the dev console and exposed on /api/dev/last-magic-link (mock mode only).
// - RESEND_API_KEY without EMAIL_FROM: Resend's test sender (delivers only to the
//   Resend account owner's inbox) — fine for the first real test.
// - EMAIL_FROM set to a verified-domain address: full delivery.

const TEST_SENDER = "Fajr Alarm <onboarding@resend.dev>";
let lastDevMagicLink: { email: string; url: string; at: string } | null = null;

export function getLastDevMagicLink() {
  return lastDevMagicLink;
}

function sender(env: Env): string {
  return env.EMAIL_FROM?.trim() || TEST_SENDER;
}

async function send(env: Env, to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender(env), to: [to], subject, html, text }),
    });
    if (!res.ok) {
      console.error("Email send failed:", res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Email send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

function wrap(locale: "ar" | "en", inner: string, footer: string): string {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const align = locale === "ar" ? "right" : "left";
  return `<!doctype html><html dir="${dir}" lang="${locale}"><body style="margin:0;padding:0;background:#f6f4ef;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <div style="background:#ffffff;border:1px solid #e7e1d3;border-radius:16px;padding:32px 28px;text-align:${align};">
      ${inner}
    </div>
    <p style="text-align:center;color:#a39d8f;font-size:12px;margin-top:16px;">${footer}</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export async function sendMagicLink(env: Env, email: string, url: string, locale: "ar" | "en"): Promise<"sent" | "logged"> {
  if (!env.RESEND_API_KEY) {
    lastDevMagicLink = { email, url, at: new Date().toISOString() };
    console.log(`[dev] magic link for ${email}: ${url}`);
    return "logged";
  }
  const safeUrl = escapeHtml(url);
  const copy =
    locale === "ar"
      ? {
          subject: "رابط الدخول إلى منبّه الفجر",
          title: "رابط دخولك جاهز",
          body: "اضغط الزر خلال ١٥ دقيقة لتسجيل الدخول. إذا ما طلبت هذا الرابط، تجاهل الرسالة.",
          button: "تسجيل الدخول",
          footer: "منبّه الفجر لأسرّة Eight Sleep",
          text: `رابط الدخول (صالح ١٥ دقيقة): ${url}`,
        }
      : {
          subject: "Your sign-in link for Fajr Alarm",
          title: "Your sign-in link is ready",
          body: "Tap the button within 15 minutes to sign in. If you didn't request this, just ignore it.",
          button: "Sign in",
          footer: "Fajr Alarm for Eight Sleep",
          text: `Sign-in link (valid 15 minutes): ${url}`,
        };
  const html = wrap(
    locale,
    `<h1 style="font-size:20px;color:#1e2a3a;margin:0 0 12px;">${copy.title}</h1>
     <p style="color:#4a4a44;line-height:1.9;font-size:15px;margin:0 0 20px;">${copy.body}</p>
     <p style="margin:0 0 20px;"><a href="${safeUrl}" style="display:inline-block;background:#1e2a3a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;">${copy.button}</a></p>
     <p style="color:#a39d8f;font-size:12px;word-break:break-all;margin:0;" dir="ltr">${safeUrl}</p>`,
    copy.footer,
  );
  await send(env, email, copy.subject, html, copy.text);
  return "sent";
}

export async function sendNeedsAttention(env: Env, email: string, locale: "ar" | "en", code: EightErrorCode): Promise<void> {
  const origin = (env.APP_ORIGIN ?? "").replace(/\/$/, "");
  const link = `${origin}/connect`;
  const reasonAr =
    code === "NO_SUBSCRIPTION"
      ? "حساب Eight Sleep ما فيه اشتراك Autopilot فعّال، والمنبّهات تحتاجه."
      : code === "AUTH_FAILED" || code === "INVALID_CREDENTIALS"
        ? "انتهت صلاحية ربط حساب Eight Sleep (غالباً بعد تغيير كلمة المرور أو تسجيل الخروج)."
        : "تعذّر تحديث المنبّه عدة مرات متتالية.";
  const reasonEn =
    code === "NO_SUBSCRIPTION"
      ? "Your Eight Sleep account has no active Autopilot subscription, which alarms require."
      : code === "AUTH_FAILED" || code === "INVALID_CREDENTIALS"
        ? "The link to your Eight Sleep account expired (usually after a password change or sign-out)."
        : "We could not update your alarm several times in a row.";
  const copy =
    locale === "ar"
      ? {
          subject: "منبّه الفجر يحتاج انتباهك",
          title: "توقّف تحديث منبّه الفجر",
          body: `${reasonAr} أعد ربط حسابك من الرابط التالي ليرجع المنبّه يتحدّث كل يوم.`,
          button: "إعادة الربط",
          footer: "منبّه الفجر لأسرّة Eight Sleep",
        }
      : {
          subject: "Fajr Alarm needs your attention",
          title: "Your Fajr alarm stopped updating",
          body: `${reasonEn} Reconnect your account below so the alarm keeps following Fajr every day.`,
          button: "Reconnect",
          footer: "Fajr Alarm for Eight Sleep",
        };
  const html = wrap(
    locale,
    `<h1 style="font-size:20px;color:#1e2a3a;margin:0 0 12px;">${copy.title}</h1>
     <p style="color:#4a4a44;line-height:1.9;font-size:15px;margin:0 0 20px;">${escapeHtml(copy.body)}</p>
     <p style="margin:0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1e2a3a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;">${copy.button}</a></p>`,
    copy.footer,
  );
  const ok = await send(env, email, copy.subject, html, `${copy.body}\n${link}`);
  if (!ok) console.log(`[dev] needs-attention email for ${email} (${code}) not sent (no RESEND_API_KEY)`);
}
