import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadBackOfficeSettings } from "@/lib/data/back-office-settings";
import { accrualSummary, listBatches, rateMismatches } from "@/lib/data/commission-accrual";
import { commissionItems } from "@/lib/data/back-office-queue";
import { approveCommissionBatch, setCommissionRate } from "@/lib/actions/back-office-actions";
import { AutomationCard, Kpi, KpiRow, NeedsYouStrip, NotReady, SectionHeading, usd } from "./back-office-parts";
import { ActionButton, SettingNumber, SettingSwitch } from "./back-office-controls";
import { OpenButton, OpenEntity } from "./admin-open";

/**
 * Admin › Finance: commissions that accrue themselves.
 *
 * Money lands, each person who carried the job accrues their share at their
 * rate on file, and once a week the payable rows become one statement per
 * person and one total for the owner. Approving the total records every
 * payout in it. The strip also lists affiliates whose rate on file is not
 * the default, each with a one-tap fix.
 */
export async function CommissionsPanel() {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const settings = await loadBackOfficeSettings(supabase, organizationId);
  if (!settings.ready) return <NotReady what="Commission accrual" />;

  const [items, mismatches, people, batches] = await Promise.all([
    commissionItems(organizationId).catch(() => []),
    rateMismatches(organizationId, settings).catch(() => []),
    accrualSummary(organizationId, settings).catch(() => []),
    listBatches(organizationId, 6).catch(() => []),
  ]);
  const mismatchBy = new Map(mismatches.map((m) => [m.profileId, m]));
  const payable = people.reduce((s, p) => s + p.payable, 0);
  const waiting = people.reduce((s, p) => s + p.waiting, 0);
  const awaiting = batches.filter((b) => b.status === "awaiting_approval");
  const approved4 = batches.filter((b) => b.status === "approved").slice(0, 4).reduce((s, b) => s + b.total, 0);

  return (
    <section className="grid gap-4">
      <NeedsYouStrip
        items={items}
        renderAction={(item) => {
          if (item.action?.name === "approveCommissionBatch") {
            return (
              <ActionButton run={approveCommissionBatch.bind(null, item.action.arg)} variant="default" confirm={`${item.title}?`}>
                Approve {item.amount != null ? usd(item.amount) : ""}
              </ActionButton>
            );
          }
          const m = item.kind === "affiliate_rate" ? mismatchBy.get(item.key.split(":")[1]) : undefined;
          if (!m) return null;
          return (
            <span className="flex flex-wrap gap-1">
              <ActionButton run={setCommissionRate.bind(null, { profileId: m.profileId, role: "affiliate", pct: m.expected })} variant="default">
                Set {m.expected}%
              </ActionButton>
              {m.onFile != null && m.onFile !== m.expected && (
                <ActionButton run={setCommissionRate.bind(null, { profileId: m.profileId, role: "affiliate", pct: m.onFile })}>Keep {m.onFile}%</ActionButton>
              )}
            </span>
          );
        }}
      />

      <KpiRow>
        <Kpi label="Waiting for approval" value={usd(awaiting.reduce((s, b) => s + b.total, 0))} target="approved weekly" tone={awaiting.length > 1 ? "bad" : awaiting.length === 1 ? "warn" : "good"} />
        <Kpi label="Payable, next statement" value={usd(payable)} tone="plain" />
        <Kpi label="Accrued, not payable yet" value={usd(waiting)} tone="plain" />
        <Kpi label="Paid by statement, last 4 weeks" value={usd(approved4)} tone="plain" />
      </KpiRow>

      <div className="grid gap-3 md:grid-cols-2">
        <AutomationCard
          title="Accrue commission on payments"
          how="On every paid invoice (Stripe's invoice.paid) and every payment recorded on a job, each share accrues at the person's rate on file. A daily run catches anything missed and builds last week's statements after Sunday."
          on={settings.commissionAccrualOn}
          since={settings.commissionAccrualStartedAt}
        >
          <SettingSwitch setting="commissionAccrualOn" on={settings.commissionAccrualOn} label="Accrue and batch weekly" hint="Only money that arrives after it's switched on." />
          <SettingNumber setting="defaultAccountManagerPct" value={settings.defaultAccountManagerPct} label="Account manager default" suffix="%" />
          <SettingNumber setting="defaultEvaluatorPct" value={settings.defaultEvaluatorPct} label="Evaluator default" suffix="%" />
          <SettingNumber setting="defaultAffiliatePct" value={settings.defaultAffiliatePct} label="Affiliate default" suffix="%" />
        </AutomationCard>
        <AutomationCard
          title="Hold-back"
          how={`Pays ${settings.holdbackCollectPct}% of the account manager's and evaluator's share on collection, and the rest once the job closes at ${settings.holdbackMarginPct}% gross margin or better. Affiliates are always paid on collection.`}
          on={settings.holdbackOn}
          since={null}
        >
          <SettingSwitch setting="holdbackOn" on={settings.holdbackOn} label="Hold back part until the job closes" hint="Applies to payments accrued after it's switched on." />
          <SettingNumber setting="holdbackCollectPct" value={settings.holdbackCollectPct} label="Paid on collection" suffix="%" />
          <SettingNumber setting="holdbackMarginPct" value={settings.holdbackMarginPct} label="Margin to release the rest" suffix="%" />
          <SettingNumber setting="holdbackCrewCostPerHour" value={settings.holdbackCrewCostPerHour} label="Crew cost per hour, for margin" suffix="$" />
        </AutomationCard>
      </div>

      <SectionHeading>Accrued, by person</SectionHeading>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{settings.commissionAccrualOn ? "Nothing accrued yet. It starts with the next payment." : "Switch accrual on to start."}</p>
      ) : (
        <ul className="grid gap-1">
          {people.map((p) => (
            <li key={p.profileId} className="grid gap-0.5 rounded-lg bg-muted px-3 py-2 text-sm sm:grid-cols-[minmax(0,12rem)_auto_minmax(0,1fr)] sm:gap-3">
              <OpenEntity kind="admin.profile" id={p.profileId} className="font-semibold">
                {p.name}
              </OpenEntity>
              <span>
                {usd(p.payable)} payable{p.waiting > 0 ? ` · ${usd(p.waiting)} waiting` : ""}
              </span>
              <span className="text-muted-foreground">{p.reasons.slice(0, 2).join(" ")}</span>
            </li>
          ))}
        </ul>
      )}

      <SectionHeading>Weekly statements</SectionHeading>
      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No statements yet.</p>
      ) : (
        <ul className="grid gap-2">
          {batches.map((b) => (
            <li key={b.id} className="rounded-xl border bg-card">
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-4 py-2">
                  <span className="font-semibold">
                    {b.weekStart} to {b.weekEnd}
                  </span>
                  <span className="font-mono">{usd(b.total)}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.status === "approved" ? `Approved ${b.approvedAt ? new Date(b.approvedAt).toLocaleDateString("en-US") : ""}` : b.status === "void" ? "Void" : "Waiting for approval"}
                  </span>
                </summary>
                <div className="grid gap-2 border-t px-4 pb-3 pt-2">
                  {b.statements.map((s) => (
                    <div key={s.profileId}>
                      <OpenEntity kind="admin.commission_statement" id={`${b.id}:${s.profileId}`} className="text-sm font-semibold">
                        {s.name}: {usd(s.total)}
                      </OpenEntity>
                      <ul className="text-sm text-muted-foreground">
                        {s.lines.map((l) => (
                          <li key={l.jobId}>
                            <OpenEntity kind="admin.job" id={l.jobId}>
                              {l.customer ?? "Job"}
                            </OpenEntity>{" "}
                            {usd(l.amount)}
                            {l.offset > 0 ? ` (${usd(l.offset)} already paid by hand)` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div>
                    <OpenButton kind="admin.commission_batch" id={b.id} label="Open the week" />
                  </div>
                  {b.status === "awaiting_approval" && (
                    <ActionButton run={approveCommissionBatch.bind(null, b.id)} variant="default" confirm={`Approve ${usd(b.total)} and record it as paid?`}>
                      Approve {usd(b.total)}
                    </ActionButton>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
