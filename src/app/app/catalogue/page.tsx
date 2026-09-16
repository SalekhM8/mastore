import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

function pounds(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  return `£${(minor / 100).toFixed(2)}`;
}

export default async function CataloguePage() {
  const { workspace } = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: products } = await supabase
    .from("products")
    .select(
      "id, title, item_type, base_price_minor, cost_minor, status, skus(id, sku, sku_stock(on_hand), channel_listings(id, status, managed, channel_accounts(channel)))",
    )
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(500);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-500">{products?.length ?? 0} products</span>
          <Link
            href="/app/catalogue/new"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            New product
          </Link>
        </div>
      </div>
      {(products?.length ?? 0) === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          Nothing here yet. Connect a channel and import its listings, or add a product.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">SKU</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">In stock</th>
                <th className="py-2 pr-4">Price</th>
                <th className="py-2 pr-4">Cost</th>
                <th className="py-2 pr-4">Channels</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {products?.map((p) => {
                const skus = (p.skus ?? []) as Array<{
                  id: string;
                  sku: string;
                  sku_stock: { on_hand: number } | { on_hand: number }[] | null;
                  channel_listings: Array<{
                    id: string;
                    status: string;
                    managed: boolean;
                    channel_accounts: { channel: string } | null;
                  }>;
                }>;
                const first = skus[0];
                const stockRaw = first?.sku_stock;
                const onHand = Array.isArray(stockRaw) ? (stockRaw[0]?.on_hand ?? 0) : (stockRaw?.on_hand ?? 0);
                const listings = skus.flatMap((s) => s.channel_listings ?? []);
                return (
                  <tr key={p.id}>
                    <td className="max-w-md truncate py-2 pr-4">
                      <Link href={`/app/catalogue/${p.id}`} className="hover:underline">
                        {p.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">{first?.sku}</td>
                    <td className="py-2 pr-4 capitalize">{p.item_type}</td>
                    <td className={`py-2 pr-4 ${onHand <= 0 ? "text-red-600" : ""}`}>{onHand}</td>
                    <td className="py-2 pr-4">{pounds(p.base_price_minor)}</td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {p.cost_minor === null ? "unknown" : pounds(p.cost_minor)}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {listings.map((l) => (
                          <span
                            key={l.id}
                            className={`rounded px-2 py-0.5 text-xs capitalize ${l.managed ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
                            title={l.managed ? "Managed by Mastore" : "Imported, not managed yet"}
                          >
                            {l.channel_accounts?.channel} · {l.status}
                          </span>
                        ))}
                      </div>
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
