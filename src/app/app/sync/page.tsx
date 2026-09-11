import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { acknowledgeIncident, retryJob } from "./actions";

const JOB_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Updating…",
  succeeded: "Done",
  failed: "Retrying",
  superseded: "Superseded",
  dead: "Failed",
};

function describeError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string")
    return (e as { message: string }).message;
  return "";
}

export default async function SyncPage() {
  const { workspace } = await requireWorkspace();
  const supabase = await supabaseServer();
  const ws = workspace.id;
  const [jobs, incidents] = await Promise.all([
    supabase
      .from("push_jobs")
      .select(
        "id, kind, status, attempts, priority, desired, next_attempt_at, last_error, created_at, finished_at, channel_accounts(channel, display_name), channel_listings(external_listing_id, title_snapshot)",
      )
      .eq("workspace_id", ws)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("incidents")
      .select("id, kind, severity, status, details, created_at, channel_accounts(channel, display_name)")
      .eq("workspace_id", ws)
      .neq("status", "resolved")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
      <p className="mt-1 text-sm text-zinc-500">Every update Sync has sent or is about to send, newest first.</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="py-2 pr-4">When</th>
              <th className="py-2 pr-4">Channel</th>
              <th className="py-2 pr-4">Listing</th>
              <th className="py-2 pr-4">Change</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {jobs.data?.length ? (
              jobs.data.map((j) => {
                const desired = (j.desired ?? {}) as { quantity?: number };
                const acct = j.channel_accounts as { channel: string; display_name: string } | null;
                const listing = j.channel_listings as {
                  external_listing_id: string;
                  title_snapshot: string | null;
                } | null;
                const status = JOB_LABEL[j.status] ?? j.status;
                const tone =
                  j.status === "dead"
                    ? "text-red-600"
                    : j.status === "failed"
                      ? "text-amber-600"
                      : j.status === "succeeded"
                        ? "text-emerald-600"
                        : "";
                return (
                  <tr key={j.id}>
                    <td className="py-2 pr-4 text-zinc-500">{new Date(j.created_at).toLocaleString("en-GB")}</td>
                    <td className="py-2 pr-4 capitalize">{acct?.channel}</td>
                    <td className="py-2 pr-4">{listing?.title_snapshot ?? listing?.external_listing_id}</td>
                    <td className="py-2 pr-4">
                      {j.kind === "delist"
                        ? "End listing"
                        : j.kind === "stock"
                          ? `Quantity → ${desired.quantity ?? 0}`
                          : j.kind}
                    </td>
                    <td className={`py-2 pr-4 ${tone}`}>
                      {status}
                      {j.status === "failed" ? ` (attempt ${j.attempts} of 6)` : ""}
                      {j.status === "dead" && j.last_error ? (
                        <div className="text-xs text-zinc-500">{describeError(j.last_error)}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      {j.status === "dead" ? (
                        <form action={retryJob}>
                          <input type="hidden" name="jobId" value={j.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
                          >
                            Retry
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="py-6 text-center text-zinc-500">
                  No updates yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 id="incidents" className="mt-10 text-lg font-semibold">
        Incidents
      </h2>
      {incidents.data?.length ? (
        <ul className="mt-3 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {incidents.data.map((i) => {
            const acct = i.channel_accounts as { channel: string; display_name: string } | null;
            return (
              <li key={i.id} className="flex items-center gap-4 py-2">
                <span className="w-36 shrink-0 text-zinc-500">{new Date(i.created_at).toLocaleString("en-GB")}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${i.severity === 1 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
                >
                  {i.kind.replace("_", " ")}
                </span>
                <span className="capitalize">{acct?.channel}</span>
                <span className="flex-1 text-zinc-500">{i.status}</span>
                {i.status === "open" ? (
                  <form action={acknowledgeIncident}>
                    <input type="hidden" name="incidentId" value={i.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
                    >
                      Acknowledge
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">No open incidents.</p>
      )}
    </div>
  );
}
