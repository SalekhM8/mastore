import { Sidebar } from "@/components/app/Sidebar";
import { currentUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await currentUser();
  return (
    <div className="flex min-h-screen flex-col bg-bone md:flex-row">
      <Sidebar email={user?.email ?? null} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">{children}</div>
      </main>
    </div>
  );
}
