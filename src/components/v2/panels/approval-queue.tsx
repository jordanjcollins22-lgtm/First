import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadApprovalQueue, declineReport } from "@/lib/data/approval-queue";
import { loadPolicy } from "@/lib/data/approval-policy";
import { countByType, queueLine, QUEUE_TYPE_LABEL, QUEUE_TYPES } from "@/lib/approvals/queue";
import { DECLINE_REASON_FIX, DECLINE_REASON_LABEL, declineRateLine } from "@/lib/approvals/declines";
import { whatLabel } from "@/lib/outbound-approval";
import { ApprovalQueueList } from "@/components/v2/panels/approval-queue-list";
import { DigestControls } from "@/components/v2/panels/digest-controls";

/** Declined share of decided held emails the owner should aim under once triggers are fixed. */
const DECLINE_RATE_TARGET = 10;

/**
 * Admin › Oversight: the one approval queue.
 *
 * Everything that waits on the owner, from wherever it lives: held emails,
 * prices needing a yes, marketing plays, social posts nobody has sent,
 * property-manager drafts, and exceptions that came up to the owner. One
 * row each, the soonest-stale first. Under it, how often the owner says no
 * and why, and the two automations that keep the list short: the email
 * policy and the Monday digest.
 *
 * Read with the service role: the /v2 page has already checked the viewer
 * is owner-level, and every source here is scoped to their business.
 */
export async function ApprovalQueuePanel() {
  const organizationId = await getCurrentOrganizationId();
  const admin = createAdminClient();
  const now = new Date();
  const [items, report, policy] = await Promise.all([
    loadApprovalQueue(admin, organizationId, now),
    declineReport(admin, organizationId, 28, now).catch(() => null),
    loadPolicy(admin, organizationId),
  ]);
  const counts = countByType(items);
  const declineRate = report && report.emailsDecided > 0 ? Math.round((report.emailsDeclined / report.emailsDecided) * 100) : null;

  return (
    <section className="grid gap-5 rounded-2xl border bg-card p-4 sm:p-5">
      <header>
        <h2 className="text-lg font-extrabold">Approval queue</h2>
        <p className="text-sm text-muted-foreground">{queueLine(items.length)}. Everything any department needs you for, in one list.</p>
      </header>

      {/* Needs you */}
      <ApprovalQueueList items={items} />

      {/* KPIs against target */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi label="Waiting on you" value={String(items.length)} good={items.length <= 5} target="5 or fewer" />
        <Kpi label="Held emails" value={String(counts.email)} good={counts.email <= 3} target="3 or fewer" />
        <Kpi
          label="Emails declined, 4 weeks"
          value={declineRate === null ? "—" : `${declineRate}%`}
          good={declineRate === null ? null : declineRate <= DECLINE_RATE_TARGET}
          target={`${DECLINE_RATE_TARGET}% or less`}
        />
        <Kpi label="Closed by the app, 4 weeks" value={String(report?.emailsMoot ?? 0)} good={null} target="Cancelled or already handled" />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {QUEUE_TYPES.filter((t) => counts[t] > 0)
          .map((t) => `${counts[t]} ${QUEUE_TYPE_LABEL[t].toLowerCase()}`)
          .join(" · ") || "Nothing in any department."}
      </p>

      {/* Why the owner says no */}
      <div className="grid gap-2 rounded-xl border p-3">
        <h3 className="font-bold">Why things get declined</h3>
        {report && report.total > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              Last 4 weeks: {report.total} declined with a reason
              {declineRateLine(report.emailsDeclined, report.emailsDecided) ? `; held emails ${declineRateLine(report.emailsDeclined, report.emailsDecided)}` : ""}.
            </p>
            <ol className="grid gap-1.5">
              {report.top.map((r) => (
                <li key={r.reason} className="rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="font-semibold">
                    {DECLINE_REASON_LABEL[r.reason]}: {r.count}
                  </span>
                  <span className="text-muted-foreground"> · {r.kinds.slice(0, 3).map((k) => `${whatLabel(k.kind)} ${k.count}`).join(", ")}</span>
                  <span className="block text-xs text-muted-foreground">{DECLINE_REASON_FIX[r.reason]}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No reasons recorded yet. Each Decline asks for one, so this fills in from the next one.</p>
        )}
      </div>

      {/* Automations */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-2 rounded-xl border p-3">
          <h3 className="font-bold">Email approval policy</h3>
          <p className="text-sm">
            {policy.masterHold ? (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900 dark:bg-orange-900/40 dark:text-orange-100">
                Held: every automatic email waits for you
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                On: each kind follows its own setting
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {policy.policyStartedAt
              ? `Per-kind policy since ${new Date(policy.policyStartedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}.`
              : "Turn the master hold off once the top decline reasons are fixed; transactional emails then send on their own."}
          </p>
          <Link href="/admin/reminders" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
            Email settings
          </Link>
        </div>
        <div className="grid content-start gap-2 rounded-xl border p-3">
          <h3 className="font-bold">Monday digest</h3>
          <DigestControls enabled={policy.digestEnabled} lastSentAt={policy.digestLastSentAt} />
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, good, target }: { label: string; value: string; good: boolean | null; target: string }) {
  const cls =
    good === null
      ? "bg-muted"
      : good
        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
        : "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100";
  return (
    <div className={"rounded-lg p-3 " + cls}>
      <div className="text-xs">{label}</div>
      <div className="font-mono text-2xl">{value}</div>
      <div className="text-[11px] opacity-80">Target: {target}</div>
    </div>
  );
}
