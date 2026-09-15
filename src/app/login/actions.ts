"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const LinkForm = z.object({ email: z.string().email(), next: z.string().startsWith("/").default("/app") });
const PasswordForm = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  next: z.string().startsWith("/").default("/app"),
});

export async function sendMagicLink(formData: FormData): Promise<void> {
  const parsed = LinkForm.safeParse({ email: formData.get("email"), next: formData.get("next") ?? "/app" });
  if (!parsed.success) redirect("/login?error=Enter+a+valid+email+address");
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${appUrl}/auth/confirm?next=${encodeURIComponent(parsed.data.next)}` },
  });
  if (error) {
    const msg =
      error.code === "over_email_send_rate_limit"
        ? "Too many sign-in emails in the last hour. Wait a while, or sign in with a password below."
        : "Could not send the link. Try again in a minute.";
    redirect(`/login?error=${encodeURIComponent(msg)}`);
  }
  redirect("/login?sent=1");
}

/** Password sign-in. Supabase's leaked-password check applies. See docs/security-and-compliance.md section 7. */
export async function signInWithPassword(formData: FormData): Promise<void> {
  const parsed = PasswordForm.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? "/app",
  });
  if (!parsed.success) redirect("/login?error=Enter+your+email+and+a+password+of+at+least+8+characters");
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) redirect(`/login?error=${encodeURIComponent("Email or password did not match.")}`);
  redirect(parsed.data.next);
}
