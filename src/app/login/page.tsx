import { sendMagicLink } from "./actions";

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const sent = sp.sent === "1";
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : "/app";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to Sync</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        We will email you a link. No password to remember.
      </p>
      {sent ? (
        <div className="mt-8 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          Check your inbox. The link is valid for one hour. Locally, open Mailpit at http://127.0.0.1:54324.
        </div>
      ) : (
        <form action={sendMagicLink} className="mt-8 flex flex-col gap-3">
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
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="you@shop.co.uk"
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            className="mt-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Email me a sign-in link
          </button>
        </form>
      )}
    </main>
  );
}
