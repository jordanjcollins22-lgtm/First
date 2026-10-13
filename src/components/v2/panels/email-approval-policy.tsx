import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadPolicy, policyRows } from "@/lib/data/approval-policy";
import { HOLD_REASON_LABEL, isLowRisk } from "@/lib/approvals/policy";
import { EmailApprovalPolicyEditor } from "@/components/v2/panels/email-approval-policy-editor";
import { RowItem } from "@/components/v2/entity-drawer";

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
    admin
      .from("outbound_approvals")
      .select("id, subject, to_name, to_email, created_at, payload")
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200),
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
          . Open one to send it or say why not.
        </p>
      )}
      {(held ?? []).length > 0 && (
        <ul className="grid max-h-80 gap-1 overflow-y-auto">
          {(held ?? []).slice(0, 25).map((h) => (
            <RowItem
              key={h.id}
              className="rounded-lg bg-muted px-3 py-2 text-sm"
              row={{
                text: `${h.subject || "Held email"} · to ${h.to_name || h.to_email} · ${new Date(h.created_at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}`,
                ref: { kind: "sales.approval", id: h.id },
              }}
            />
          ))}
        </ul>
      )}
      <EmailApprovalPolicyEditor masterHold={policy.masterHold} rows={rows} />
    </section>
  );
}
