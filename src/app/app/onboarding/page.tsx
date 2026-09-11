import { createWorkspace } from "./actions";

export default async function OnboardingPage(props: PageProps<"/app/onboarding">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Name your workspace</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Usually your shop name. You can change it later.</p>
      <form action={createWorkspace} className="mt-6 flex flex-col gap-3">
        <input
          name="name"
          required
          minLength={2}
          maxLength={60}
          placeholder="Northside Vintage"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Create workspace
        </button>
      </form>
    </div>
  );
}
