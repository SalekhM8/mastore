import Link from "next/link";
import { Badge, ButtonLink, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
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
      <PageHeader
        eyebrow={`${products?.length ?? 0} products`}
        title="Catalogue"
        description="One record per item. Publish it to any channel from its page."
        actions={<ButtonLink href="/app/catalogue/new">New product</ButtonLink>}
      />
      {(products?.length ?? 0) === 0 ? (
        <Empty>Nothing here yet. Connect a channel and import its listings, or add a product.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>SKU</Th>
              <Th>Type</Th>
              <Th className="text-right">In stock</Th>
              <Th className="text-right">Price</Th>
              <Th className="text-right">Cost</Th>
              <Th>Channels</Th>
            </tr>
          </thead>
          <tbody>
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
                <tr key={p.id} className="hover:bg-white/60">
                  <Td className="max-w-md truncate font-medium">
                    <Link href={`/app/catalogue/${p.id}`} className="text-naval hover:underline">
                      {p.title}
                    </Link>
                  </Td>
                  <Td className="font-mono text-xs text-ink-muted">{first?.sku}</Td>
                  <Td className="capitalize text-ink-muted">{p.item_type}</Td>
                  <Td className={`tnum text-right ${onHand <= 0 ? "text-bad" : ""}`}>{onHand}</Td>
                  <Td className="tnum text-right">{pounds(p.base_price_minor)}</Td>
                  <Td className="tnum text-right text-ink-muted">
                    {p.cost_minor === null ? "unknown" : pounds(p.cost_minor)}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {listings.map((l) => (
                        <Badge
                          key={l.id}
                          tone={
                            l.managed
                              ? l.status === "active"
                                ? "ok"
                                : l.status === "error"
                                  ? "bad"
                                  : "neutral"
                              : "neutral"
                          }
                        >
                          <span className="capitalize">{l.channel_accounts?.channel}</span>&nbsp;· {l.status}
                        </Badge>
                      ))}
                    </div>
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
