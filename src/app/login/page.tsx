import { sendMagicLink, signInWithPassword } from "./actions";

const input = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button = "mt-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black";

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const sent = sp.sent === "1";
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : "/app";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to Mastore</h1>
      {error ? (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100">{error}</p>
      ) : null}

      {sent ? (
        <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          Check your inbox and click the link. It is valid for one hour.
        </div>
      ) : (
        <form action={sendMagicLink} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={input}
            placeholder="you@shop.co.uk"
          />
          <button type="submit" className={button}>
            Email me a sign-in link
          </button>
        </form>
      )}

      <div className="my-8 flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        or
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <form action={signInWithPassword} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label className="text-sm font-medium" htmlFor="pw-email">
          Email
        </label>
        <input id="pw-email" name="email" type="email" required autoComplete="email" className={input} />
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="current-password"
          className={input}
        />
        <button
          type="submit"
          className="mt-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Sign in with password
        </button>
      </form>
    </main>
  );
}
