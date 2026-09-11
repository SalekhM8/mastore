import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const Params = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["magiclink", "email", "signup", "recovery", "invite", "email_change"]),
  next: z.string().startsWith("/").default("/app"),
});

/** Magic link landing. Exchanges the token hash for a session cookie, then continues. */
export async function GET(request: NextRequest): Promise<Response> {
  const sp = request.nextUrl.searchParams;
  const parsed = Params.safeParse({
    token_hash: sp.get("token_hash"),
    type: sp.get("type"),
    next: sp.get("next") ?? "/app",
  });
  if (!parsed.success) redirect("/login?error=That+link+is+not+valid");
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: parsed.data.token_hash, type: parsed.data.type });
  if (error) redirect("/login?error=That+link+has+expired.+Request+a+new+one");
  redirect(parsed.data.next);
}
