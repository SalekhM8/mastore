import Link from "next/link";
import { Badge, Button, Card, Notice, PageHeader, Stat } from "@/components/ui";
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
      <p className="text-sm text-ink-muted">
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
      <Link href="/app/catalogue" className="text-sm text-ink-muted hover:underline">
        ← Catalogue
      </Link>
      <div className="mt-2">
        <PageHeader eyebrow={sku?.sku ?? ""} title={product.title} />
      </div>
      {notice ? <Notice>{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="In stock" value={onHand} tone={onHand <= 0 ? "bad" : "default"} />
        <Stat label="Price" value={pounds(product.base_price_minor)} />
        <Stat label="Cost" value={pounds(product.cost_minor)} />
        <Stat label="Margin before fees" value={margin === null ? "unknown" : pounds(margin)} />
      </div>

      <Card className="mt-6">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          {[
            ["Type", product.item_type],
            ["Condition", product.condition?.replaceAll("_", " ") ?? "not set"],
            ["Brand", product.brand ?? "not set"],
            ["Added", new Date(product.created_at).toLocaleDateString("en-GB")],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow text-ink-muted">{k}</dt>
              <dd className="mt-1 capitalize text-naval">{v}</dd>
            </div>
          ))}
        </dl>
        {photos.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {photos.map((p) => (
              // biome-ignore lint/performance/noImgElement: external marketplace photo URLs
              <img key={p.position} src={p.storage_path} alt="" className="h-20 w-20 rounded-xl object-cover" />
            ))}
          </div>
        ) : null}
        <p className="mt-4 whitespace-pre-wrap text-sm text-ink-muted">{product.description}</p>
      </Card>

      <h2 className="font-display mt-10 mb-3 text-2xl text-naval">Channels</h2>
      <Card strong className="p-0">
        <ul className="divide-y divide-concrete/50 text-sm">
          {accounts?.map((a) => {
            const l = listings.find((x) => x.channel_account_id === a.id);
            const err = l?.last_error as { message?: string } | null;
            const canPublish = !listedOn.has(a.id) || l?.status === "error" || l?.status === "ended";
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <div className="w-40">
                  <div className="font-medium capitalize text-naval">{a.channel}</div>
                  <div className="text-xs text-ink-muted">{a.display_name}</div>
                </div>
                <div className="flex-1">
                  {l ? (
                    <>
                      <Badge
                        tone={
                          l.status === "active"
                            ? "ok"
                            : l.status === "error"
                              ? "bad"
                              : l.status === "pending"
                                ? "yellow"
                                : "neutral"
                        }
                      >
                        {LISTING_LABEL[l.status] ?? l.status}
                      </Badge>
                      {l.status === "active" && !l.external_listing_id.startsWith("pending:") ? (
                        <span className="ml-2 font-mono text-xs text-ink-muted">#{l.external_listing_id}</span>
                      ) : null}
                      {l.status === "error" && err?.message ? (
                        <div className="mt-1 text-xs text-bad">{err.message}</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-ink-muted">Not listed</span>
                  )}
                </div>
                {canPublish ? (
                  <form action={publishToChannel}>
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="accountId" value={a.id} />
                    <Button type="submit" size="sm">
                      {l?.status === "error" || l?.status === "ended" ? "Publish again" : "Publish"}
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
          {(accounts?.length ?? 0) === 0 ? (
            <li className="px-5 py-4 text-ink-muted">
              No channels connected.{" "}
              <Link href="/app/channels" className="text-mineral underline">
                Connect one
              </Link>
              .
            </li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}
