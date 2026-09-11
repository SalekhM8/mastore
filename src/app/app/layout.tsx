import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";

const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/channels", label: "Channels" },
  { href: "/app/sync", label: "Sync" },
] as const;

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await currentUser();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/app" className="font-semibold tracking-tight">
              Sync
            </Link>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <form action="/auth/signout" method="post" className="flex items-center gap-3 text-sm">
            <span className="text-zinc-500">{user?.email}</span>
            <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
