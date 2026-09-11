import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
    >
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Link>
  );
}

export default async function OverviewPage() {
  const { workspace } = await requireWorkspace();
  const supabase = await supabaseServer();
  const ws = workspace.id;

  const [accounts, listings, openIncidents, queued, dead, activity] = await Promise.all([
    supabase
      .from("channel_accounts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .is("deleted_at", null),
    supabase
      .from("channel_listings")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("managed", true),
    supabase
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .neq("status", "resolved"),
    supabase
      .from("push_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("status", ["queued", "running", "failed"]),
    supabase.from("push_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "dead"),
    supabase
      .from("activity_log")
      .select("id, level, message, created_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Channels" value={accounts.count ?? 0} href="/app/channels" />
        <Stat label="Managed listings" value={listings.count ?? 0} href="/app/sync" />
        <Stat label="Updates in flight" value={queued.count ?? 0} href="/app/sync" />
        <Stat label="Needs attention" value={dead.count ?? 0} href="/app/sync" />
        <Stat label="Open incidents" value={openIncidents.count ?? 0} href="/app/sync#incidents" />
      </div>

      <h2 className="mt-10 text-lg font-semibold">Activity</h2>
      {(activity.data?.length ?? 0) === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">
          Nothing yet.{" "}
          <Link href="/app/channels" className="underline">
            Connect a channel
          </Link>{" "}
          to start.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {activity.data?.map((a) => (
            <li key={a.id} className="flex gap-4 py-2">
              <span className="w-36 shrink-0 text-zinc-500">{new Date(a.created_at).toLocaleString("en-GB")}</span>
              <span className={a.level === "error" ? "text-red-600" : a.level === "warn" ? "text-amber-600" : ""}>
                {a.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
