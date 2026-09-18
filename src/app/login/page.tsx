import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Button, inputClass, labelClass, Notice } from "@/components/ui";
import { sendMagicLink, signInWithPassword } from "./actions";

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const sent = sp.sent === "1";
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : "/app";

  return (
    <main className="naval-scene flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link href="/">
            <Logo size={26} tone="optical" />
          </Link>
        </div>
        <div className="glass-dark p-7 text-bone">
          <div className="eyebrow text-structural">The commerce headquarters</div>
          <h1 className="font-display mt-2 text-4xl text-optical">Sign in</h1>
          {error ? (
            <div className="mt-4">
              <Notice kind="error">{error}</Notice>
            </div>
          ) : null}

          {sent ? (
            <p className="mt-6 rounded-xl border border-structural/40 bg-structural/15 px-4 py-3 text-sm text-structural-200">
              Check your inbox and click the link. It is valid for one hour.
            </p>
          ) : (
            <form action={sendMagicLink} className="mt-6 flex flex-col gap-3">
              <input type="hidden" name="next" value={next} />
              <label className="text-sm font-medium text-bone" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className={inputClass}
                placeholder="you@shop.co.uk"
              />
              <Button type="submit" className="mt-1">
                Email me a sign-in link
              </Button>
            </form>
          )}

          <div className="my-7 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-bone/50">
            <span className="h-px flex-1 bg-white/15" />
            or
            <span className="h-px flex-1 bg-white/15" />
          </div>

          <form action={signInWithPassword} className="flex flex-col gap-3">
            <input type="hidden" name="next" value={next} />
            <label className="text-sm font-medium text-bone" htmlFor="pw-email">
              Email
            </label>
            <input id="pw-email" name="email" type="email" required autoComplete="email" className={inputClass} />
            <label className="text-sm font-medium text-bone" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="current-password"
              className={inputClass}
            />
            <Button type="submit" tone="ghost" className="mt-1">
              Sign in with password
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-bone/50">
          <span className={labelClass} style={{ color: "inherit" }}>
            See the whole market. Move first.
          </span>
        </p>
      </div>
    </main>
  );
}
