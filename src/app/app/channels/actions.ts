"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

const Form = z.object({ accountId: z.string().uuid(), enabled: z.enum(["0", "1"]) });

/** Turning sync on is what starts fan-out for an account. Off pauses pushes without losing them. */
export async function setSyncEnabled(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const parsed = Form.safeParse({ accountId: formData.get("accountId"), enabled: formData.get("enabled") });
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
