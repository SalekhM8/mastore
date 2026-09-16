import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { publishToChannel } from "../actions";

function pounds(minor: number | string | null | undefined): string {
  if (minor === null || minor === undefined) return "unknown";
  return `£${(Number(minor) / 100).toFixed(2)}`;
}

const LISTING_LABEL: Record<string, string> = {
  pending: "Publishing…",
  active: "Live",
  ended: "Ended",
  error: "Failed",
  draft: "Draft",
  unmanaged: "Not managed",
};

export default async function ProductPage(props: PageProps<"/app/catalogue/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  const { workspace } = await requireWorkspace();
  const supabase = await supabaseServer();

  const [{ data: product }, { data: accounts }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, title, description, brand, condition, item_type, base_price_minor, cost_minor, status, created_at, skus(id, sku, sku_stock(on_hand), channel_listings(id, status, managed, external_listing_id, pushed_quantity, last_error, channel_account_id, channel_accounts(channel, display_name))), product_photos(storage_path, position)",
      )
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("channel_accounts")
      .select("id, channel, display_name, status")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("created_at"),
  ]);

  if (!product) {
    return (
      <p className="text-sm text-zinc-500">
        Product not found.{" "}
        <Link href="/app/catalogue" className="underline">
          Back to catalogue
        </Link>
      </p>
    );
  }
  const skus = (product.skus ?? []) as Array<{
    id: string;
    sku: string;
    sku_stock: { on_hand: number } | { on_hand: number }[] | null;
    channel_listings: Array<{
      id: string;
      status: string;
      managed: boolean;
      external_listing_id: string;
      pushed_quantity: number | null;
      last_error: unknown;
      channel_account_id: string;
      channel_accounts: { channel: string; display_name: string } | null;
    }>;
  }>;
  const sku = skus[0];
  const stockRaw = sku?.sku_stock;
  const onHand = Array.isArray(stockRaw) ? (stockRaw[0]?.on_hand ?? 0) : (stockRaw?.on_hand ?? 0);
  const listings = sku?.channel_listings ?? [];
  const listedOn = new Set(listings.map((l) => l.channel_account_id));
  const photos = ((product.product_photos ?? []) as Array<{ storage_path: string; position: number }>).sort(
    (a, b) => a.position - b.position,
  );
  const margin = product.cost_minor === null ? null : Number(product.base_price_minor) - Number(product.cost_minor);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/catalogue" className="text-sm text-zinc-500 hover:underline">
        ← Catalogue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{product.title}</h1>
      {notice ? (
        <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["In stock", String(onHand)],
          ["Price", pounds(product.base_price_minor)],
          ["Cost", pounds(product.cost_minor)],
          ["Margin before fees", margin === null ? "unknown" : pounds(margin)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{k}</div>
            <div className="mt-1 text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-zinc-500">SKU</dt>
          <dd className="font-mono text-xs">{sku?.sku}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Type</dt>
          <dd className="capitalize">{product.item_type}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Condition</dt>
          <dd>{product.condition?.replaceAll("_", " ") ?? "not set"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Brand</dt>
          <dd>{product.brand ?? "not set"}</dd>
        </div>
      </dl>
      {photos.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {photos.map((p) => (
            // biome-ignore lint/performance/noImgElement: external marketplace photo URLs
            <img key={p.position} src={p.storage_path} alt="" className="h-20 w-20 rounded object-cover" />
          ))}
        </div>
      ) : null}
      <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{product.description}</p>

      <h2 className="mt-10 text-lg font-semibold">Channels</h2>
      <table className="mt-3 w-full text-sm">
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {accounts?.map((a) => {
            const l = listings.find((x) => x.channel_account_id === a.id);
            const err = l?.last_error as { message?: string } | null;
            return (
              <tr key={a.id}>
                <td className="py-2 pr-4 capitalize">
                  {a.channel} <span className="text-zinc-500">{a.display_name}</span>
                </td>
                <td className="py-2 pr-4">
                  {l ? (
                    <>
                      <span
                        className={
                          l.status === "active" ? "text-emerald-600" : l.status === "error" ? "text-red-600" : ""
                        }
                      >
                        {LISTING_LABEL[l.status] ?? l.status}
                      </span>
                      {l.status === "active" && !l.external_listing_id.startsWith("pending:") ? (
                        <span className="ml-2 font-mono text-xs text-zinc-500">#{l.external_listing_id}</span>
                      ) : null}
                      {l.status === "error" && err?.message ? (
                        <div className="text-xs text-red-600">{err.message}</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-zinc-500">Not listed</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right">
                  {!listedOn.has(a.id) || l?.status === "error" || l?.status === "ended" ? (
                    <form action={publishToChannel}>
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="accountId" value={a.id} />
                      <button
                        type="submit"
                        className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-black"
                      >
                        {l?.status === "error" || l?.status === "ended" ? "Publish again" : "Publish"}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {(accounts?.length ?? 0) === 0 ? (
            <tr>
              <td className="py-2 text-zinc-500">
                No channels connected.{" "}
                <Link href="/app/channels" className="underline">
                  Connect one
                </Link>
                .
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
