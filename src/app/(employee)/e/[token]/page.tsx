import { CrewPreview } from "@/components/crew/crew-preview";
import { resolveEmployeeLink } from "@/lib/agent/links";
import { getJobWorkspace } from "@/lib/data/jobs";
import { listServiceTemplates } from "@/lib/data/service-templates";
import { createAdminClient } from "@/lib/supabase/admin";

const REASONS = {
  not_found: "This link isn't valid.",
  expired: "This link has expired.",
  revoked: "This link was turned off.",
  inactive: "This link isn't active anymore.",
} as const;

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * A no-login page an employee opens from a text. The token in the URL is
 * the only credential: it's checked against a stored hash, it expires, and
 * it only opens the one thing it was made for.
 */
export default async function EmployeeLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();
  const resolved = await resolveEmployeeLink(supabase, token);

  if (!resolved.ok) {
    return <Message title={REASONS[resolved.reason]} body="Text the office and we'll send you a new one." />;
  }

  const { link } = resolved;
  if (link.kind === "job" && link.job_id) {
    const [workspace, serviceTemplates] = await Promise.all([
      getJobWorkspace(link.job_id, supabase),
      listServiceTemplates(supabase),
    ]);
    if (!workspace) return <Message title="This job was removed." body="Text the office if you think that's a mistake." />;
    return (
      <CrewPreview
        job={workspace.job}
        zones={workspace.zones}
        workAreas={workspace.workAreas}
        serviceTemplates={serviceTemplates}
        employeeView
      />
    );
  }

  return <Message title={REASONS.not_found} body="Text the office and we'll send you a new one." />;
}
