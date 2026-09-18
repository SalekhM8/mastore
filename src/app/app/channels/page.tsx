import { Badge, Button, Empty, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { checkOrdersNow, importListingsAction, setSyncEnabled } from "./actions";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  connecting: { label: "Connecting", tone: "neutral" },
  healthy: { label: "Connected", tone: "ok" },
  degraded: { label: "Degraded", tone: "warn" },
  auth_revoked: { label: "Reconnect needed", tone: "bad" },
  disconnected: { label: "Disconnected", tone: "bad" },
};

interface ImportStatus {
  state?: string;
  seen?: number;
  created?: number;
  linked?: number;
  error?: string;
  finished_at?: string;
}

function describeImport(s: ImportStatus | undefined): string {
  if (!s?.state) return "Not imported yet";
  if (s.state === "running") return `Importing… ${s.seen ?? 0} so far`;
  if (s.state === "failed") return `Import failed: ${s.error ?? "unknown error"}`;
  return `${s.seen ?? 0} listings, ${s.created ?? 0} new products${s.finished_at ? `, ${new Date(s.finished_at).toLocaleString("en-GB")}` : ""}`;
}

export default async function ChannelsPage(props: PageProps<"/app/channels">) {
  const { workspace } = await requireWorkspace();
  const sp = await props.searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  const supabase = await supabaseServer();
  const { data: accounts } = await supabase
    .from("channel_accounts")
    .select(
      "id, channel, display_name, marketplace, status, sync_enabled, account_settings, last_inbound_at, last_outbound_at, created_at",
    )
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("created_at");

  return (
    <div>
      <PageHeader
        eyebrow="Connections"
        title="Channels"
        description="Every marketplace account Mastore speaks to. Sync is off until you turn it on."
        actions={
          <a
            href="/connect/ebay/start"
            className="inline-flex items-center rounded-xl bg-structural px-4 py-2 text-sm font-semibold text-naval hover:bg-structural-600"
          >
            Connect eBay
          </a>
        }
      />
      {notice ? <Notice>{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      {(accounts?.length ?? 0) === 0 ? (
        <Empty>
          No channels connected. Start with eBay: it imports your listings and nothing is pushed until you turn sync on.
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Channel</Th>
              <Th>Account</Th>
              <Th>Status</Th>
              <Th>Listings</Th>
              <Th>Sync</Th>
              <Th>Last inbound</Th>
              <Th>Last outbound</Th>
            </tr>
          </thead>
          <tbody>
            {accounts?.map((a) => {
              const imp = ((a.account_settings ?? {}) as { import?: ImportStatus }).import;
              const st = STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };
              return (
                <tr key={a.id}>
                  <Td className="font-medium capitalize text-naval">{a.channel}</Td>
                  <Td>
                    {a.display_name} <span className="text-ink-muted">({a.marketplace})</span>
                  </Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <span className="text-ink-muted">{describeImport(imp)}</span>
                      <form action={importListingsAction}>
                        <input type="hidden" name="accountId" value={a.id} />
                        <Button type="submit" tone="ghost" size="sm">
                          {imp?.state ? "Import again" : "Import listings"}
                        </Button>
                      </form>
                    </div>
                  </Td>
                  <Td>
                    <form action={setSyncEnabled}>
                      <input type="hidden" name="accountId" value={a.id} />
                      <input type="hidden" name="enabled" value={a.sync_enabled ? "0" : "1"} />
                      <button
                        type="submit"
                        aria-pressed={a.sync_enabled}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${a.sync_enabled ? "bg-structural" : "bg-concrete"}`}
                        title={a.sync_enabled ? "Sync on" : "Sync off"}
                      >
                        <span
                          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${a.sync_enabled ? "translate-x-5" : "translate-x-0.5"}`}
                        />
                      </button>
                    </form>
                  </Td>
                  <Td className="text-ink-muted">
                    <div className="flex items-center gap-2">
                      <span className="tnum">
                        {a.last_inbound_at ? new Date(a.last_inbound_at).toLocaleString("en-GB") : "never"}
                      </span>
                      <form action={checkOrdersNow}>
                        <input type="hidden" name="accountId" value={a.id} />
                        <Button type="submit" tone="ghost" size="sm">
                          Check now
                        </Button>
                      </form>
                    </div>
                  </Td>
                  <Td className="tnum text-ink-muted">
                    {a.last_outbound_at ? new Date(a.last_outbound_at).toLocaleString("en-GB") : "never"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
