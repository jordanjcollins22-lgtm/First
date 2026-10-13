import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadPolicy, policyRows } from "@/lib/data/approval-policy";
import { HOLD_REASON_LABEL, isLowRisk } from "@/lib/approvals/policy";
import { EmailApprovalPolicyEditor } from "@/components/v2/panels/email-approval-policy-editor";

/**
 * Which automatic emails wait for the owner: the master hold and one
 * setting per kind. Belongs on Sales › Automated messages (and Admin ›
 * Settings, "messaging policy per kind").
 *
 * Opens with what is held right now and why, then the settings.
 */
export async function EmailApprovalPolicyPanel() {
  const organizationId = await getCurrentOrganizationId();
  const admin = createAdminClient();
  const [policy, { data: held }] = await Promise.all([
    loadPolicy(admin, organizationId),
    admin.from("outbound_approvals").select("payload").eq("organization_id", organizationId).eq("status", "pending").limit(200),
  ]);
  const why = new Map<string, number>();
  for (const row of held ?? []) {
    const reason = ((row.payload ?? {}) as { held_because?: string }).held_because ?? "master";
    why.set(reason, (why.get(reason) ?? 0) + 1);
  }
  const rows = policyRows(policy).map((r) => ({
    ...r,
    lowRisk: isLowRisk(r.kind),
    locked: r.kind === "measurements_request" || r.kind === "team_request",
  }));

  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <header>
        <h2 className="text-lg font-extrabold">Which emails wait for you</h2>
        <p className="text-sm text-muted-foreground">
          Transactional emails can go on their own; new wording, AI-written text and team requests wait. A held low-risk email set to
          &quot;waits, then sends&quot; goes on its own if you haven&apos;t stopped it in time.
        </p>
      </header>
      {(held ?? []).length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          {(held ?? []).length} held now:{" "}
          {[...why.entries()]
            .map(([reason, n]) => `${n} ${(HOLD_REASON_LABEL[reason as keyof typeof HOLD_REASON_LABEL] ?? reason).toLowerCase()}`)
            .join(", ")}
          . Approve or decline them in Admin › Oversight.
        </p>
      )}
      <EmailApprovalPolicyEditor masterHold={policy.masterHold} rows={rows} />
    </section>
  );
}
