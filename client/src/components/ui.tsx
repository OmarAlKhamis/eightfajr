import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

// Small, dependency-free primitives styled with the dawn palette tokens.

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-dawn-400";
  const sizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-[15px]", lg: "h-13 px-6 text-base" }[size];
  const variants: Record<Variant, string> = {
    primary: "bg-primary hover:opacity-90",
    accent: "bg-accent hover:opacity-90",
    secondary: "bg-elev border border-line hover:bg-sand-100 dark:hover:bg-night-800",
    ghost: "hover:bg-sand-100 dark:hover:bg-night-800",
    danger: "bg-bad-500 text-white hover:opacity-90",
  };
  return (
    <button className={cx(base, sizes, variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("bg-elev border border-line rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 mb-4">
          {title && <h2 className="text-lg font-bold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted leading-relaxed">{hint}</p>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full h-11 rounded-xl border border-line bg-app px-3 text-[15px] placeholder:text-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-dawn-400",
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("w-full h-11 rounded-xl border border-line bg-app px-3 text-[15px] focus:outline-none focus-visible:ring-2 focus-visible:ring-dawn-400", className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; id?: string }) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-3 cursor-pointer select-none">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-7 w-12 rounded-full transition-colors border border-line", checked ? "bg-ok-500" : "bg-sand-200 dark:bg-night-700")}
      >
        <span className={cx("absolute top-0.5 size-6 rounded-full bg-white shadow transition-all", checked ? "inset-s-[22px]" : "inset-s-0.5")} style={{ insetInlineStart: checked ? 22 : 2 }} />
      </button>
      {label && <span className="text-[15px]">{label}</span>}
    </label>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "ok" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  const tones = {
    ok: "bg-ok-500/15 text-ok-500",
    warn: "bg-warn-500/15 text-warn-500",
    bad: "bg-bad-500/15 text-bad-500",
    neutral: "bg-sand-200/70 text-muted dark:bg-night-700",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", tones)}>{children}</span>;
}

export function Alert({ tone = "neutral", children }: { tone?: "ok" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  const tones = {
    ok: "border-ok-500/40 bg-ok-500/10",
    warn: "border-warn-500/40 bg-warn-500/10",
    bad: "border-bad-500/40 bg-bad-500/10",
    neutral: "border-line bg-sand-100 dark:bg-night-800",
  }[tone];
  return <div className={cx("rounded-xl border px-4 py-3 text-sm leading-relaxed", tones)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-muted", className)} aria-label="loading" />;
}
