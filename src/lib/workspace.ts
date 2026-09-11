import { redirect } from "next/navigation";
import { currentUser, supabaseServer } from "./supabase/server";

export interface WorkspaceContext {
  userId: string;
  email: string | null;
  workspace: { id: string; name: string; slug: string };
}

/**
 * The signed-in user and their first workspace. Redirects to sign-in or onboarding when
 * either is missing. Every page under /app starts here.
 */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const supabase = await supabaseServer();
  const { data } = await supabase.from("workspaces").select("id, name, slug").order("created_at").limit(1);
  const workspace = data?.[0];
  if (!workspace) redirect("/app/onboarding");
  return { userId: user.id, email: user.email ?? null, workspace };
}
