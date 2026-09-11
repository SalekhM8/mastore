"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requestPushes } from "@/jobs/push";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

const JobForm = z.object({ jobId: z.string().uuid() });
const IncidentForm = z.object({ incidentId: z.string().uuid() });

/** One-click retry of a dead job. The RPC checks membership; then we nudge the queue. */
export async function retryJob(formData: FormData): Promise<void> {
  await requireWorkspace();
  const parsed = JobForm.safeParse({ jobId: formData.get("jobId") });
  if (!parsed.success) return;
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("retry_push_job", { p_job_id: parsed.data.jobId });
  if (!error) await requestPushes([parsed.data.jobId]);
  revalidatePath("/app/sync");
}

export async function acknowledgeIncident(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const parsed = IncidentForm.safeParse({ incidentId: formData.get("incidentId") });
  if (!parsed.success) return;
  const supabase = await supabaseServer();
  await supabase
    .from("incidents")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .eq("id", parsed.data.incidentId)
    .eq("workspace_id", workspace.id);
  revalidatePath("/app/sync");
}
