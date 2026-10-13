import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadBackOfficeSettings } from "@/lib/data/back-office-settings";
import { businessToday, listObligations } from "@/lib/data/compliance";
import { complianceItems } from "@/lib/data/back-office-queue";
import { KIND_LABEL, creditsShort, daysUntil, isInsurance, type ObligationKind } from "@/lib/compliance/calendar";
import { fertilizerWindowOn } from "@/lib/compliance/fertilizer-blackout";
import { confirmObligationDate, markObligationDone, seedComplianceDefaults } from "@/lib/actions/back-office-actions";
import { AutomationCard, Kpi, KpiRow, NeedsYouStrip, NotReady, SectionHeading } from "./back-office-parts";
import { ActionButton, DocUpload, OpenDoc, SettingSwitch } from "./back-office-controls";
import { ObligationEditor } from "./obligation-editor";

/**
 * Admin › Settings: the Maryland compliance calendar.
 *
 * Licenses, certifications, insurance, registrations and filings, each with
 * its date, its document and a reminder to the owner at 60, 30 and 7 days.
 * Overdue items and anything due within 45 days sit on the needs-you strip.
 * The fertilizer blackout guard and the certificates of insurance sent to
 * clients live here too.
 */

const STATE_CHIP: Record<string, string> = {
  overdue: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  due_soon: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  upcoming: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100",
  ok: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
  no_date: "bg-muted text-muted-foreground",
  inactive: "bg-muted text-muted-foreground",
};

const WINDOW_TEXT = {
  open: "Fertilizer season is open.",
  certified_only: "Late fall: only a certified applicator may fertilize, up to 0.5 lb N per 1,000 sq ft, until Dec 1.",
  blackout: "Fertilizer blackout until March 1: no nitrogen or phosphorus on lawns.",
};

export async function CompliancePanel() {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const settings = await loadBackOfficeSettings(supabase, organizationId);
  if (!settings.ready) return <NotReady what="The compliance calendar" />;

  const now = new Date();
  const today = businessToday(now);
  const [{ obligations }, items, cois] = await Promise.all([
    listObligations(organizationId, settings.reminderDays, now),
    complianceItems(organizationId, now).catch(() => []),
    (createAdminClient() as unknown as SupabaseClient)
      .from("client_cois")
      .select("id, holder_name, created_at, sent_at, sent_to, customer:customers(id, name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const active = obligations.filter((o) => o.active);
  const overdue = active.filter((o) => o.state === "overdue").length;
  const confirmed = active.filter((o) => o.dueOn && o.dateConfirmed).length;
  const insurance = active.filter((o) => isInsurance(o.kind));
  const insuranceWithCoi = insurance.filter((o) => o.documentPath && o.dueOn && o.dueOn >= today).length;
  const recentCois = (cois.data ?? []) as unknown as { id: string; holder_name: string; created_at: string; sent_at: string | null; sent_to: string | null; customer: { id: string; name: string } | null }[];

  return (
    <section className="grid gap-4">
      <NeedsYouStrip items={items} />

      <KpiRow>
        <Kpi label="Overdue" value={String(overdue)} target="0" tone={overdue ? "bad" : "good"} />
        <Kpi label="Due within 45 days" value={String(items.filter((i) => i.kind === "compliance_due_soon").length)} tone="plain" />
        <Kpi label="Dates confirmed" value={`${confirmed}/${active.length}`} target="all" tone={confirmed === active.length && active.length > 0 ? "good" : "warn"} />
        <Kpi label="Policies with a current COI" value={`${insuranceWithCoi}/${insurance.length}`} target="all" tone={insurance.length > 0 && insuranceWithCoi === insurance.length ? "good" : "warn"} />
      </KpiRow>

      <div className="grid gap-3 md:grid-cols-2">
        <AutomationCard
          title="Compliance reminders"
          how="Texts (or emails) the owner 60, 30 and 7 days before each date and again when it's overdue. Seeded dates stay quiet until confirmed."
          on={settings.complianceRemindersOn}
          since={settings.complianceRemindersStartedAt}
        >
          <SettingSwitch setting="complianceRemindersOn" on={settings.complianceRemindersOn} label="Send reminders" />
          {obligations.length === 0 && (
            <ActionButton run={seedComplianceDefaults} variant="default">
              Add Maryland defaults
            </ActionButton>
          )}
        </AutomationCard>
        <AutomationCard
          title="Fertilizer blackout guard"
          how="Refuses to book a fertilizer visit, or approve a proposal with fertilizer planned, from Nov 16 to Mar 1. Certified applicators may go to Dec 1 at 0.5 lb N per 1,000 sq ft."
          on={settings.fertilizerGuardOn}
          since={null}
        >
          <SettingSwitch setting="fertilizerGuardOn" on={settings.fertilizerGuardOn} label="Block fertilizer in the blackout" hint={WINDOW_TEXT[fertilizerWindowOn(today)]} />
        </AutomationCard>
      </div>

      <SectionHeading>Calendar</SectionHeading>
      {obligations.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Nothing on the calendar yet. Add the Maryland defaults above, then confirm each date.</p>
      ) : (
        <ul className="grid gap-2">
          {obligations.map((o) => {
            const left = o.dueOn ? daysUntil(o.dueOn, today) : null;
            const short = creditsShort(o);
            return (
              <li key={o.id} className={`rounded-xl border bg-card p-3 ${o.active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_CHIP[o.state]}`}>
                    {o.state === "inactive"
                      ? "Not held"
                      : o.state === "no_date"
                        ? "No date yet"
                        : left! < 0
                          ? `${-left!} days overdue`
                          : left === 0
                            ? "Due today"
                            : `${left} days`}
                  </span>
                  {o.active && o.dueOn && !o.dateConfirmed && (
                    <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100">Confirm the date</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {KIND_LABEL[o.kind as ObligationKind] ?? o.kind}
                  {o.dueOn ? ` · due ${o.dueOn}` : ""}
                  {o.holder ? ` · ${o.holder}` : ""}
                  {short != null ? ` · ${short === 0 ? "credits done" : `${short} credits to go`}` : ""}
                  {o.policyNumber ? ` · policy ${o.policyNumber}` : ""}
                </p>
                {o.notes && <p className="mt-1 text-xs text-muted-foreground">{o.notes}</p>}
                <div className="mt-2 flex flex-wrap items-start gap-1">
                  {o.active && o.dueOn && !o.dateConfirmed && <ActionButton run={confirmObligationDate.bind(null, o.id)}>Date is right</ActionButton>}
                  {o.active && o.dueOn && <ActionButton run={markObligationDone.bind(null, o.id)}>Mark done</ActionButton>}
                  <DocUpload area="obligation" id={o.id} label={o.documentPath ? "Replace file" : isInsurance(o.kind) ? "Upload COI" : "Upload"} />
                  {o.documentPath && <OpenDoc area="obligation" id={o.id} />}
                  <ObligationEditor
                    initial={{
                      id: o.id,
                      kind: o.kind,
                      title: o.title,
                      holder: o.holder,
                      dueOn: o.dueOn,
                      recurrence: o.recurrence,
                      active: o.active,
                      dateConfirmed: o.dateConfirmed,
                      creditsRequired: o.creditsRequired,
                      creditsEarned: o.creditsEarned,
                      carrier: o.carrier,
                      policyNumber: o.policyNumber,
                      coverageLimits: o.coverageLimits,
                      notes: o.notes,
                    }}
                  />
                  {o.sourceUrl && (
                    <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center px-3 text-sm text-primary underline-offset-4 hover:underline">
                      Source
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ObligationEditor label="Add something to the calendar" />

      <SectionHeading>Certificates of insurance sent to clients</SectionHeading>
      <p className="text-sm text-muted-foreground">
        A commercial client who asks gets one from their client page: Certificate of insurance › Make and send. It prints the policies above with the client as certificate holder.
      </p>
      {recentCois.length === 0 ? (
        <p className="text-sm text-muted-foreground">None issued yet.</p>
      ) : (
        <ul className="grid gap-1">
          {recentCois.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              <a href={c.customer ? `/clients/${c.customer.id}` : "#"} className="font-medium hover:underline">
                {c.customer?.name ?? "Client"} · {c.holder_name}
              </a>
              <span className="text-muted-foreground">
                {c.sent_at ? `Sent ${new Date(c.sent_at).toLocaleDateString("en-US")} to ${c.sent_to}` : `Made ${new Date(c.created_at).toLocaleDateString("en-US")}, not sent`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
