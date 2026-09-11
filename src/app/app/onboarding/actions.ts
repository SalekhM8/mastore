"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const Form = z.object({ name: z.string().trim().min(2).max(60) });

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "workspace"}-${randomBytes(2).toString("hex")}`;
}

export async function createWorkspace(formData: FormData): Promise<void> {
  const parsed = Form.safeParse({ name: formData.get("name") });
  if (!parsed.success) redirect("/app/onboarding?error=Use+2+to+60+characters");
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("create_workspace", {
    p_name: parsed.data.name,
    p_slug: slugify(parsed.data.name),
  });
  if (error) redirect(`/app/onboarding?error=${encodeURIComponent("Could not create the workspace. Try again.")}`);
  redirect("/app");
}
