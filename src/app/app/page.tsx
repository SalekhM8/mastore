import Link from "next/link";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

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
      <PageHeader eyebrow="Headquarters" title={workspace.name} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Channels" value={accounts.count ?? 0} href="/app/channels" />
        <Stat label="Managed listings" value={listings.count ?? 0} href="/app/catalogue" />
        <Stat label="Updates in flight" value={queued.count ?? 0} href="/app/sync" />
        <Stat
          label="Needs attention"
          value={dead.count ?? 0}
          href="/app/sync"
          tone={(dead.count ?? 0) > 0 ? "bad" : "default"}
        />
        <Stat
          label="Open incidents"
          value={openIncidents.count ?? 0}
          href="/app/sync#incidents"
          tone={(openIncidents.count ?? 0) > 0 ? "warn" : "default"}
        />
      </div>

      <h2 className="font-display mt-10 mb-3 text-2xl text-naval">Activity</h2>
      {(activity.data?.length ?? 0) === 0 ? (
        <Empty>
          Nothing yet.{" "}
          <Link href="/app/channels" className="text-mineral underline">
            Connect a channel
          </Link>{" "}
          to start.
        </Empty>
      ) : (
        <Card strong className="p-0">
          <ul className="divide-y divide-concrete/50 text-sm">
            {activity.data?.map((a) => (
              <li key={a.id} className="flex gap-4 px-5 py-3">
                <span className="tnum w-36 shrink-0 text-ink-muted">
                  {new Date(a.created_at).toLocaleString("en-GB")}
                </span>
                <span className={a.level === "error" ? "text-bad" : a.level === "warn" ? "text-warn" : "text-naval"}>
                  {a.message}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
