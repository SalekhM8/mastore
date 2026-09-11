"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const Form = z.object({ email: z.string().email(), next: z.string().startsWith("/").default("/app") });

export async function sendMagicLink(formData: FormData): Promise<void> {
  const parsed = Form.safeParse({ email: formData.get("email"), next: formData.get("next") ?? "/app" });
  if (!parsed.success) redirect("/login?error=Enter+a+valid+email+address");
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${appUrl}/auth/confirm?next=${encodeURIComponent(parsed.data.next)}` },
  });
  if (error) redirect(`/login?error=${encodeURIComponent("Could not send the link. Try again in a minute.")}`);
  redirect("/login?sent=1");
}
