import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const Next = z.string().startsWith("/").default("/app");
const OtpType = z.enum(["magiclink", "email", "signup", "recovery", "invite", "email_change"]);

/**
 * Magic link landing. Supabase can deliver the link in two shapes depending on the email template:
 * a PKCE `code` (the default when the sign-in started from this app), or a `token_hash` plus `type`
 * (when the template is customised). Both end in a session cookie, then we continue to `next`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const sp = request.nextUrl.searchParams;
  const next = Next.catch("/app").parse(sp.get("next") ?? "/app");
  const supabase = await supabaseServer();

  const code = sp.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error)
      redirect(`/login?error=${encodeURIComponent("That link has expired or was already used. Request a new one.")}`);
    redirect(next);
  }

  const tokenHash = sp.get("token_hash");
  const type = OtpType.safeParse(sp.get("type"));
  if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type.data });
    if (error)
      redirect(`/login?error=${encodeURIComponent("That link has expired or was already used. Request a new one.")}`);
    redirect(next);
  }

  // Supabase reports template or link problems in the query string.
  const desc = sp.get("error_description");
  redirect(`/login?error=${encodeURIComponent(desc ?? "That link is not valid. Request a new one.")}`);
}
