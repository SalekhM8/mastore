import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";

const NAV = [
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-naval/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" aria-label="Mastore HQ home">
          <Logo size={22} tone="optical" />
        </Link>
        <nav className="flex items-center gap-6 text-sm text-bone/80">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-optical">
              {n.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="rounded-xl bg-structural px-4 py-2 font-semibold text-naval hover:bg-structural-600"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-naval text-bone/70">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs">
        <div className="flex items-center gap-3">
          <Logo size={18} tone="optical" />
          <span>Salekh Ventures Ltd, England and Wales.</span>
        </div>
        <nav className="flex flex-wrap gap-5">
          <Link href="/pricing" className="hover:text-optical">
            Pricing
          </Link>
          <Link href="/privacy" className="hover:text-optical">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-optical">
            Terms
          </Link>
          <Link href="/contact" className="hover:text-optical">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bone">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}

/** A long-form legal or informational page. */
export function Prose({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <SiteShell>
      <article className="mx-auto w-full max-w-3xl px-6 py-14">
        <div className="eyebrow text-mineral">{eyebrow}</div>
        <h1 className="font-display mt-2 text-5xl text-naval sm:text-6xl">{title}</h1>
        {updated ? <p className="mt-3 text-sm text-ink-muted">Last updated {updated}</p> : null}
        <div className="prose-mastore mt-8 space-y-4 text-[15px] leading-7 text-naval/90 [&_h2]:font-display [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:text-naval [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_a]:text-mineral [&_a]:underline">
          {children}
        </div>
      </article>
    </SiteShell>
  );
}
