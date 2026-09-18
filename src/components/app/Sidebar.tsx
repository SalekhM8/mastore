"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo, Mark } from "@/components/brand/Logo";

/**
 * Stripe-style sidebar. Wide by default, collapses to an icon rail, remembers the choice.
 * On phones it slides in over the page.
 */

const NAV = [
  { href: "/app", label: "Overview", icon: IconGrid },
  { href: "/app/catalogue", label: "Catalogue", icon: IconBox },
  { href: "/app/channels", label: "Channels", icon: IconPlug },
  { href: "/app/sync", label: "Sync", icon: IconArrows },
] as const;

const KEY = "mastore.sidebar.collapsed";

export function Sidebar({ email }: { email: string | null }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === "1");
    } catch {}
  }, []);
  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setMobileOpen(false), [pathname]);

  const width = collapsed ? "w-[72px]" : "w-[248px]";
  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-concrete bg-bone px-4 py-3 md:hidden">
        <Logo size={22} />
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-lg border border-concrete p-2"
        >
          <IconMenu />
        </button>
      </div>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-naval/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={`sidebar-transition fixed inset-y-0 left-0 z-40 flex flex-col bg-naval text-bone md:sticky md:top-0 md:h-screen ${width} ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"} ${collapsed ? "" : "w-[248px]"}`}
      >
        <div className={`flex h-16 items-center ${collapsed ? "justify-center" : "justify-between px-5"}`}>
          {collapsed ? <Mark size={26} tone="optical" /> : <Logo size={22} tone="optical" />}
          {!collapsed ? (
            <button
              type="button"
              onClick={toggle}
              aria-label="Collapse sidebar"
              className="hidden rounded-md p-1 text-bone/60 hover:bg-white/10 hover:text-bone md:block"
            >
              <IconChevron dir="left" />
            </button>
          ) : null}
        </div>

        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const on = active(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${on ? "bg-white/10 text-optical" : "text-bone/70 hover:bg-white/5 hover:text-bone"} ${collapsed ? "justify-center" : ""}`}
              >
                {on ? <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-structural" /> : null}
                <Icon />
                {!collapsed ? <span>{label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className={`border-t border-white/10 p-3 ${collapsed ? "flex flex-col items-center gap-2" : ""}`}>
          {collapsed ? (
            <button
              type="button"
              onClick={toggle}
              aria-label="Expand sidebar"
              className="hidden rounded-md p-1 text-bone/60 hover:bg-white/10 hover:text-bone md:block"
            >
              <IconChevron dir="right" />
            </button>
          ) : (
            <div className="truncate px-2 text-xs text-bone/60">{email}</div>
          )}
          <form action="/auth/signout" method="post" className={collapsed ? "" : "mt-2 px-2"}>
            <button
              type="submit"
              title="Sign out"
              className={`rounded-lg text-xs text-bone/70 hover:text-bone ${collapsed ? "p-1" : "underline-offset-4 hover:underline"}`}
            >
              {collapsed ? <IconExit /> : "Sign out"}
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function IconGrid() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  );
}
function IconBox() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  );
}
function IconPlug() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3" />
    </svg>
  );
}
function IconArrows() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}
function IconMenu() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function IconExit() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
    </svg>
  );
}
function IconChevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {dir === "left" ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}
