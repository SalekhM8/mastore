import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Shared primitives. Keep them dumb: layout and tone only, no data. */

type Tone = "primary" | "secondary" | "ghost" | "danger";

const buttonTone: Record<Tone, string> = {
  primary: "bg-structural text-naval hover:bg-structural-600 shadow-[0_6px_20px_-8px_rgba(255,183,43,0.8)]",
  secondary: "bg-naval text-optical hover:bg-naval-700",
  ghost: "bg-white/60 text-naval border border-concrete hover:bg-white",
  danger: "bg-bad text-optical hover:opacity-90",
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold tracking-tight transition-colors disabled:opacity-50";

export function Button({
  tone = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { tone?: Tone; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "px-3 py-1.5 text-xs" : "";
  return <button {...props} className={`${buttonBase} ${buttonTone[tone]} ${sz} ${className}`} />;
}

export function ButtonLink({
  tone = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { tone?: Tone; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "px-3 py-1.5 text-xs" : "";
  return <Link {...props} className={`${buttonBase} ${buttonTone[tone]} ${sz} ${className}`} />;
}

export function Card({
  children,
  className = "",
  strong = false,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return <div className={`${strong ? "glass-strong" : "glass"} p-5 ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  eyebrow,
  actions,
  description,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  description?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <div className="eyebrow text-mineral">{eyebrow}</div> : null}
        <h1 className="font-display mt-1 text-4xl text-naval sm:text-5xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: "default" | "warn" | "bad";
}) {
  const v = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-naval";
  const body = (
    <>
      <div className="eyebrow text-ink-muted">{label}</div>
      <div className={`font-display mt-2 text-4xl ${v}`}>{value}</div>
    </>
  );
  return href ? (
    <Link href={href} className="glass block p-4 transition-transform hover:-translate-y-0.5">
      {body}
    </Link>
  ) : (
    <div className="glass p-4">{body}</div>
  );
}

export function Notice({ kind = "ok", children }: { kind?: "ok" | "error" | "info"; children: ReactNode }) {
  const tone =
    kind === "error"
      ? "border-bad/30 bg-bad/10 text-bad"
      : kind === "info"
        ? "border-mineral/30 bg-mineral/10 text-mineral"
        : "border-ok/30 bg-ok/10 text-ok";
  return <p className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tone}`}>{children}</p>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad" | "yellow";
}) {
  const t = {
    neutral: "bg-concrete/60 text-ink-muted",
    ok: "bg-ok/10 text-ok",
    warn: "bg-warn/10 text-warn",
    bad: "bg-bad/10 text-bad",
    yellow: "bg-structural/25 text-naval",
  }[tone];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export const inputClass =
  "w-full rounded-xl border border-concrete bg-white/80 px-3 py-2 text-sm text-naval placeholder:text-concrete-600 focus:border-mineral focus:bg-white";

export const labelClass = "text-sm font-medium text-naval";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="glass-strong overflow-x-auto p-0">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`eyebrow border-b border-concrete/70 px-4 py-3 text-left text-ink-muted ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-concrete/40 px-4 py-3 align-middle ${className}`}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="glass p-8 text-center text-sm text-ink-muted">{children}</div>;
}
