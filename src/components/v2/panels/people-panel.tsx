import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadBackOfficeSettings } from "@/lib/data/back-office-settings";
import { listChecklists } from "@/lib/data/onboarding";
import { roleProblems } from "@/lib/data/role-mapping";
import { peopleItems } from "@/lib/data/back-office-queue";
import { AutomationCard, Kpi, KpiRow, NeedsYouStrip, NotReady, SectionHeading } from "./back-office-parts";
import { DocUpload, OpenDoc, SettingSwitch } from "./back-office-controls";
import { ChecklistSettings, ItemToggle, RoleFixButton } from "./people-controls";
import { OpenButton, OpenEntity } from "./admin-open";

/**
 * Admin › Team & access: new-hire checklists and the old-to-new role map.
 *
 * Every hire gets the federal and Maryland paperwork with its deadlines,
 * tracked per person, with the forms stored privately. Anybody whose roles
 * the app does not recognise, or whose roles pull against each other, is
 * listed with one fix to tap.
 */
const POSITION: Record<string, string> = {
  "account-manager": "Account manager",
  evaluator: "Evaluator",
  affiliate: "Affiliate",
  "project-technician": "Project technician",
  "project-lead": "Project lead",
};

export async function PeoplePanel() {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const settings = await loadBackOfficeSettings(supabase, organizationId);

  const [items, problems, { checklists, ready }] = await Promise.all([
    peopleItems(organizationId).catch(() => []),
    roleProblems(organizationId).catch(() => []),
    listChecklists(organizationId),
  ]);
  const open = checklists.filter((c) => !c.progress.complete);
  const overdue = checklists.reduce((s, c) => s + c.progress.overdue, 0);
  const unmapped = problems.filter((p) => p.problem === "unmapped").length;

  return (
    <section className="grid gap-4">
      <NeedsYouStrip items={items} />

      <KpiRow>
        <Kpi label="Onboarding items overdue" value={String(overdue)} target="0" tone={overdue ? "bad" : "good"} />
        <Kpi label="Hires still onboarding" value={String(open.length)} tone="plain" />
        <Kpi label="People with no recognised role" value={String(unmapped)} target="0" tone={unmapped ? "warn" : "good"} />
        <Kpi label="Role fixes waiting" value={String(problems.length)} target="0" tone={problems.length ? "warn" : "good"} />
      </KpiRow>

      {settings.ready ? (
        <AutomationCard
          title="New-hire checklists"
          how="When somebody is marked hired in Hiring, or added on the Team page, they get a checklist: I-9, W-4, MW507, the Maryland new-hire report within 20 days, handbook, safety training, and MDA pesticide training within 30 days if they'll handle chemicals. Overdue items go to the owner."
          on={settings.onboardingOn}
          since={settings.onboardingStartedAt}
        >
          <SettingSwitch setting="onboardingOn" on={settings.onboardingOn} label="Create checklists on hire" hint="Only for people hired after it's switched on." />
        </AutomationCard>
      ) : (
        <NotReady what="New-hire checklists" />
      )}

      <SectionHeading>Onboarding</SectionHeading>
      {!ready || checklists.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checklists yet.</p>
      ) : (
        <ul className="grid gap-2">
          {checklists.map((c) => (
            <li key={c.id} className="rounded-xl border bg-card">
              <details open={!c.progress.complete && c.progress.overdue > 0}>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-4 py-2">
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-sm text-muted-foreground">{POSITION[c.position ?? ""] ?? c.position ?? ""}</span>
                  <span className="text-sm">
                    {c.progress.done}/{c.progress.total} done
                  </span>
                  {c.progress.overdue > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900 dark:bg-red-900/40 dark:text-red-100">{c.progress.overdue} overdue</span>
                  )}
                </summary>
                <div className="grid gap-2 border-t px-4 pb-3 pt-2">
                  <div>
                    <OpenButton kind="admin.onboarding" id={c.id} label="Open the checklist" />
                  </div>
                  <ChecklistSettings checklistId={c.id} startDate={c.startDate} handlesPesticides={c.handlesPesticides} />
                  <ul className="grid gap-1">
                    {c.items.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
                        <span className={`min-w-0 flex-1 ${i.doneAt || i.waived ? "text-muted-foreground line-through" : ""}`}>
                          <OpenEntity kind="admin.onboarding_item" id={i.id}>
                            {i.label}
                          </OpenEntity>
                          <span className={`ml-2 text-xs ${i.overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                            {i.waived ? "doesn't apply" : i.doneAt ? `done ${new Date(i.doneAt).toLocaleDateString("en-US")}` : `due ${i.dueOn}`}
                          </span>
                        </span>
                        <DocUpload area="onboarding" id={i.id} label={i.documentPath ? "Replace" : "Upload form"} />
                        {i.documentPath && <OpenDoc area="onboarding" id={i.id} />}
                        <ItemToggle itemId={i.id} done={Boolean(i.doneAt)} waived={i.waived} />
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <SectionHeading>Roles: old to new</SectionHeading>
      <p className="text-sm text-muted-foreground">
        Everybody should hold one of the five roles: owner, account manager, evaluator, project lead or crew. These people don&apos;t, or hold an old name, or hold two that pull against each other.
      </p>
      {problems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Everybody maps to a role.</p>
      ) : (
        <ul className="grid gap-2">
          {problems.map((p) => (
            <li key={`${p.profileId}:${p.problem}`} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
              <div className="min-w-0 flex-1">
                <OpenEntity kind="admin.profile" id={p.profileId} className="font-semibold">
                  {p.name}
                </OpenEntity>
                <p className="text-sm text-muted-foreground">{p.detail}</p>
              </div>
              <RoleFixButton profileId={p.profileId} fix={p.fix} choose={p.problem === "unmapped"} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
