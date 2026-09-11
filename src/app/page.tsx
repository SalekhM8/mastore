import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sync</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        One catalogue for UK resellers. Sell an item on eBay and it comes off Depop, Vinted and everywhere else before
        the next buyer can pay for it.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/login"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
