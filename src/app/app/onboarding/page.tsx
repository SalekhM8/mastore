import { Button, Card, inputClass, labelClass, Notice, PageHeader } from "@/components/ui";
import { createWorkspace } from "./actions";

export default async function OnboardingPage(props: PageProps<"/app/onboarding">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        eyebrow="Welcome"
        title="Name your workspace"
        description="Usually your shop name. You can change it later."
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Card strong>
        <form action={createWorkspace} className="flex flex-col gap-3">
          <label className={labelClass} htmlFor="name">
            Workspace name
          </label>
          <input
            id="name"
            name="name"
            required
            minLength={2}
            maxLength={60}
            placeholder="Northside Vintage"
            className={inputClass}
          />
          <Button type="submit" className="mt-2 self-start">
            Create workspace
          </Button>
        </form>
      </Card>
    </div>
  );
}
