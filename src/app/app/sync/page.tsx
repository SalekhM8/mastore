import { Badge, Button, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { acknowledgeIncident, retryJob } from "./actions";

const JOB: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "yellow" }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Updating…", tone: "yellow" },
  succeeded: { label: "Done", tone: "ok" },
  failed: { label: "Retrying", tone: "warn" },
  superseded: { label: "Superseded", tone: "neutral" },
  dead: { label: "Failed", tone: "bad" },
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
      <PageHeader
        eyebrow="Outbound"
        title="Sync"
        description="Every update Mastore has sent or is about to send, newest first."
      />

      {jobs.data?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Channel</Th>
              <Th>Listing</Th>
              <Th>Change</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {jobs.data.map((j) => {
              const desired = (j.desired ?? {}) as { quantity?: number };
              const acct = j.channel_accounts as { channel: string; display_name: string } | null;
              const listing = j.channel_listings as {
                external_listing_id: string;
                title_snapshot: string | null;
              } | null;
              const st = JOB[j.status] ?? { label: j.status, tone: "neutral" as const };
              const change =
                j.kind === "delist"
                  ? "End listing"
                  : j.kind === "stock"
                    ? `Quantity → ${desired.quantity ?? 0}`
                    : j.kind === "listing_create"
                      ? "Publish listing"
                      : j.kind;
              return (
                <tr key={j.id}>
                  <Td className="tnum text-ink-muted">{new Date(j.created_at).toLocaleString("en-GB")}</Td>
                  <Td className="capitalize">{acct?.channel}</Td>
                  <Td className="max-w-xs truncate">{listing?.title_snapshot ?? listing?.external_listing_id}</Td>
                  <Td>{change}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {j.status === "failed" ? (
                      <span className="ml-2 text-xs text-ink-muted">attempt {j.attempts} of 6</span>
                    ) : null}
                    {j.status === "dead" && j.last_error ? (
                      <div className="mt-1 text-xs text-bad">{describeError(j.last_error)}</div>
                    ) : null}
                  </Td>
                  <Td>
                    {j.status === "dead" ? (
                      <form action={retryJob}>
                        <input type="hidden" name="jobId" value={j.id} />
                        <Button type="submit" tone="ghost" size="sm">
                          Retry
                        </Button>
                      </form>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <Empty>No updates yet.</Empty>
      )}

      <h2 id="incidents" className="font-display mt-10 mb-3 text-2xl text-naval">
        Incidents
      </h2>
      {incidents.data?.length ? (
        <Card strong className="p-0">
          <ul className="divide-y divide-concrete/50 text-sm">
            {incidents.data.map((i) => {
              const acct = i.channel_accounts as { channel: string; display_name: string } | null;
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <span className="tnum w-36 shrink-0 text-ink-muted">
                    {new Date(i.created_at).toLocaleString("en-GB")}
                  </span>
                  <Badge tone={i.severity === 1 ? "bad" : "warn"}>{i.kind.replaceAll("_", " ")}</Badge>
                  <span className="capitalize">{acct?.channel}</span>
                  <span className="flex-1 text-ink-muted">{i.status}</span>
                  {i.status === "open" ? (
                    <form action={acknowledgeIncident}>
                      <input type="hidden" name="incidentId" value={i.id} />
                      <Button type="submit" tone="ghost" size="sm">
                        Acknowledge
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <Empty>No open incidents.</Empty>
      )}
    </div>
  );
}
