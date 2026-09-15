"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getChannelAccount } from "@/db/channel-accounts";
import { EVENTS, inngest } from "@/jobs/client";
import { runImport } from "@/jobs/import";
import { withContext } from "@/lib/log";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

const ToggleForm = z.object({ accountId: z.string().uuid(), enabled: z.enum(["0", "1"]) });
const AccountForm = z.object({ accountId: z.string().uuid() });

/** Turning sync on is what starts fan-out for an account. Off pauses pushes without losing them. */
export async function setSyncEnabled(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const parsed = ToggleForm.safeParse({ accountId: formData.get("accountId"), enabled: formData.get("enabled") });
  if (!parsed.success) redirect("/app/channels?error=Bad+request");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("channel_accounts")
    .update({ sync_enabled: parsed.data.enabled === "1" })
    .eq("id", parsed.data.accountId)
    .eq("workspace_id", workspace.id);
  if (error) redirect(`/app/channels?error=${encodeURIComponent("Could not update the account.")}`);
  revalidatePath("/app/channels");
}

/**
 * Import the account's listings. Queued on the job runner; if the runner cannot be reached
 * (local development without it) the import runs inline so the seller still gets a result.
 */
export async function importListingsAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const parsed = AccountForm.safeParse({ accountId: formData.get("accountId") });
  if (!parsed.success) redirect("/app/channels?error=Bad+request");
  const row = await getChannelAccount(parsed.data.accountId);
  if (!row || row.workspace_id !== workspace.id) redirect("/app/channels?error=Account+not+found");
  const log = withContext({ workspaceId: workspace.id, channel: row.channel, channelAccountId: row.id });
  try {
    await inngest.send({
      name: EVENTS.importRequested,
      data: { channelAccountId: row.id, workspaceId: workspace.id, channel: row.channel },
    });
    log.info("import queued");
    redirect(`/app/channels?notice=${encodeURIComponent("Import started. This page updates as it runs.")}`);
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "digest" in e &&
      String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
    )
      throw e;
    log.warn({ err: e }, "job runner unreachable, importing inline");
  }
  const result = await runImport(row);
  const msg =
    "pages" in result
      ? `Imported ${result.seen} listings, ${result.created} new products.`
      : `Import skipped: ${result.skipped}.`;
  revalidatePath("/app/channels");
  redirect(`/app/channels?notice=${encodeURIComponent(msg)}`);
}
