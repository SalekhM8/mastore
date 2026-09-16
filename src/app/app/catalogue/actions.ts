"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createPendingListing, createProductWithSku, getProductForListing } from "@/db/catalogue";
import { getChannelAccount } from "@/db/channel-accounts";
import { db } from "@/db/client";
import { applyLedgerEvent } from "@/db/ledger";
import { logActivity } from "@/db/ops";
import { enqueueListingCreateJob } from "@/db/push-jobs";
import type { ListingDraft } from "@/domain/channels/types";
import { manualKey } from "@/domain/ledger/idempotency";
import { CHANNEL_LABEL } from "@/jobs/connectors";
import { requestPushesOrRun } from "@/jobs/push";
import { requireWorkspace } from "@/lib/workspace";

const ProductForm = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(20000),
  price: z.coerce.number().positive(),
  quantity: z.coerce.number().int().min(1).max(100000),
  condition: z.enum([
    "new",
    "new_other",
    "refurbished",
    "used_like_new",
    "used_very_good",
    "used_good",
    "used_acceptable",
    "for_parts",
  ]),
  brand: z.string().trim().max(65).optional(),
  cost: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  sku: z.string().trim().max(80).optional(),
  photos: z.string().optional(),
});

function generatedSku(): string {
  return `MAS-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function createProduct(formData: FormData): Promise<void> {
  const { workspace, userId } = await requireWorkspace();
  const parsed = ProductForm.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    redirect(
      `/app/catalogue/new?error=${encodeURIComponent(`Check: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`)}`,
    );
  }
  const f = parsed.data;
  const sku = f.sku && f.sku.length > 0 ? f.sku : generatedSku();
  const photoUrls = (f.photos ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));

  const { productId, skuId } = await createProductWithSku({
    workspaceId: workspace.id,
    title: f.title,
    itemType: f.quantity <= 1 ? "unique" : "stocked",
    priceMinor: Math.round(f.price * 100),
    sku,
    condition: f.condition,
    attributes: {},
  });
  const sql = db();
  await sql`update public.products set description = ${f.description}, brand = ${f.brand ?? null},
            cost_minor = ${f.cost === "" || f.cost === undefined ? null : Math.round(f.cost * 100)} where id = ${productId}`;
  for (const [i, url] of photoUrls.entries()) {
    await sql`insert into public.product_photos (workspace_id, product_id, position, storage_path) values (${workspace.id}, ${productId}, ${i}, ${url})`;
  }
  await applyLedgerEvent({
    workspaceId: workspace.id,
    skuId,
    kind: "restock",
    quantityDelta: f.quantity,
    idempotencyKey: manualKey({ userId, skuId, action: "restock", clientId: "initial" }),
    actor: `user:${userId}`,
    metadata: { reason: "created in Mastore" },
  });
  await logActivity({ workspaceId: workspace.id, skuId, message: `Added ${f.title} with ${f.quantity} in stock.` });
  revalidatePath("/app/catalogue");
  redirect(`/app/catalogue/${productId}`);
}

const PublishForm = z.object({ productId: z.string().uuid(), accountId: z.string().uuid() });

/** Publish a product to one connected channel account. Queues a listing_create push; runs inline if the runner is away. */
export async function publishToChannel(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const parsed = PublishForm.safeParse({ productId: formData.get("productId"), accountId: formData.get("accountId") });
  if (!parsed.success) redirect("/app/catalogue?error=Bad+request");
  const back = `/app/catalogue/${parsed.data.productId}`;
  const product = await getProductForListing(workspace.id, parsed.data.productId);
  const account = await getChannelAccount(parsed.data.accountId);
  if (!product || !account || account.workspace_id !== workspace.id) redirect(`${back}?error=Not+found`);
  if (product.on_hand <= 0)
    redirect(`${back}?error=${encodeURIComponent("Nothing in stock to list. Add stock first.")}`);

  const draft: ListingDraft = {
    sku: product.sku,
    title: product.title,
    description: product.description || product.title,
    priceMinor: Number(product.base_price_minor),
    quantity: product.on_hand,
    condition: (product.condition ?? "used_very_good") as ListingDraft["condition"],
    photoUrls: product.photo_urls,
    ...(product.brand ? { brand: product.brand } : {}),
  };
  const listingId = await createPendingListing({
    workspaceId: workspace.id,
    channelAccountId: account.id,
    skuId: product.sku_id,
    priceMinor: draft.priceMinor,
    quantity: draft.quantity,
    titleSnapshot: product.title,
  });
  const jobId = await enqueueListingCreateJob({
    workspaceId: workspace.id,
    channelAccountId: account.id,
    channelListingId: listingId,
    draft,
    quantity: draft.quantity,
    ledgerSeq: Number(product.last_event_seq),
  });
  const r = await requestPushesOrRun([jobId]);
  revalidatePath(back);
  const label = CHANNEL_LABEL[account.channel];
  redirect(
    `${back}?notice=${encodeURIComponent(r.ran > 0 ? `${label}: publish finished. See the listing status below.` : `${label}: publish queued.`)}`,
  );
}
