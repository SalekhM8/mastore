import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { checkOrdersNow, importListingsAction, setSyncEnabled } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting",
  healthy: "Connected",
  degraded: "Degraded",
  auth_revoked: "Reconnect needed",
  disconnected: "Disconnected",
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <a
          href="/connect/ebay/start"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Connect eBay
        </a>
      </div>
      {notice ? (
        <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p>
      ) : null}

      {(accounts?.length ?? 0) === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          No channels connected. Start with eBay: it imports your listings and nothing is pushed until you turn sync on.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-4">Channel</th>
                <th className="py-2 pr-4">Account</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Listings</th>
                <th className="py-2 pr-4">Sync</th>
                <th className="py-2 pr-4">Last inbound</th>
                <th className="py-2 pr-4">Last outbound</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {accounts?.map((a) => {
                const imp = ((a.account_settings ?? {}) as { import?: ImportStatus }).import;
                return (
                  <tr key={a.id}>
                    <td className="py-2 pr-4 capitalize">{a.channel}</td>
                    <td className="py-2 pr-4">
                      {a.display_name} <span className="text-zinc-500">({a.marketplace})</span>
                    </td>
                    <td className="py-2 pr-4">{STATUS_LABEL[a.status] ?? a.status}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600 dark:text-zinc-400">{describeImport(imp)}</span>
                        <form action={importListingsAction}>
                          <input type="hidden" name="accountId" value={a.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
                          >
                            {imp?.state ? "Import again" : "Import listings"}
                          </button>
                        </form>
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      <form action={setSyncEnabled}>
                        <input type="hidden" name="accountId" value={a.id} />
                        <input type="hidden" name="enabled" value={a.sync_enabled ? "0" : "1"} />
                        <button
                          type="submit"
                          className={`rounded-md border px-3 py-1 text-xs ${a.sync_enabled ? "border-emerald-500 text-emerald-700" : "border-zinc-300 text-zinc-600 dark:border-zinc-700"}`}
                        >
                          {a.sync_enabled ? "On" : "Off"}
                        </button>
                      </form>
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">
                      <div className="flex items-center gap-2">
                        <span>{a.last_inbound_at ? new Date(a.last_inbound_at).toLocaleString("en-GB") : "never"}</span>
                        <form action={checkOrdersNow}>
                          <input type="hidden" name="accountId" value={a.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700"
                          >
                            Check now
                          </button>
                        </form>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {a.last_outbound_at ? new Date(a.last_outbound_at).toLocaleString("en-GB") : "never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
