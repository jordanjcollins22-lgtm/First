import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadBackOfficeSettingsAdmin } from "@/lib/data/back-office-settings";
import { listObligations } from "@/lib/data/compliance";
import { listChecklists } from "@/lib/data/onboarding";
import { roleProblems } from "@/lib/data/role-mapping";
import { rateMismatches } from "@/lib/data/commission-accrual";
import { daysUntil } from "@/lib/compliance/calendar";
import { businessToday } from "@/lib/data/compliance";

/**
 * Everything in the back office that needs a person, in one shape.
 *
 * This is the hook for the unified approval queue (workstream A1) and for
 * each panel's needs-you strip. The queue pulls; nothing here pushes, so the
 * queue and the panels can never disagree about what is waiting. Each item
 * has a stable key, so a queue that stores items can dedupe on it, and an
 * item disappears from here the moment it is dealt with.
 */

export type BackOfficeItemKind =
  | "commission_payout"
  | "compliance_overdue"
  | "compliance_due_soon"
  | "onboarding_overdue"
  | "role_unmapped"
  | "affiliate_rate";

export interface BackOfficeItem {
  /** Stable: the same thing waiting is always the same key. */
  key: string;
  kind: BackOfficeItemKind;
  /** "approval" needs a yes/no from the owner; "exception" needs something done. */
  type: "approval" | "exception";
  title: string;
  detail: string | null;
  /** Dollars, for an approval of money. */
  amount: number | null;
  /** Where to deal with it. */
  href: string;
  /**
   * The one-tap action, when there is one: the server action's name in
   * src/lib/actions/back-office-actions.ts and the argument to pass.
   */
  action: { name: "approveCommissionBatch"; arg: string } | null;
  at: string | null;
}

/** The Admin page, opened on the choice that holds each screen. */
export const PANEL_HREF = {
  finance: "/v2/admin?choice=finance",
  teamAccess: "/v2/admin?choice=people",
  settings: "/v2/admin?choice=settings",
};

/** How close a renewal has to be before it is an exception on Settings. */
export const EXPIRY_WARNING_DAYS = 45;

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function commissionItems(organizationId: string): Promise<BackOfficeItem[]> {
  const sb = createAdminClient() as unknown as SupabaseClient;
  const settings = await loadBackOfficeSettingsAdmin(organizationId);
  const [{ data: batches }, mismatches] = await Promise.all([
    sb
      .from("commission_payout_batches")
      .select("id, week_start, week_end, total, people, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "awaiting_approval")
      .order("week_start", { ascending: true }),
    rateMismatches(organizationId, settings).catch(() => []),
  ]);
  const items: BackOfficeItem[] = ((batches ?? []) as { id: string; week_start: string; week_end: string; total: number; people: number; created_at: string }[]).map((b) => ({
    key: `commission_batch:${b.id}`,
    kind: "commission_payout",
    type: "approval",
    title: `Approve commission: ${money(Number(b.total))} to ${b.people} ${b.people === 1 ? "person" : "people"}`,
    detail: `Week of ${b.week_start} to ${b.week_end}. Approving records the payouts.`,
    amount: Number(b.total),
    href: PANEL_HREF.finance,
    action: { name: "approveCommissionBatch", arg: b.id },
    at: b.created_at,
  }));
  for (const m of mismatches) {
    items.push({
      key: `affiliate_rate:${m.profileId}`,
      kind: "affiliate_rate",
      type: "exception",
      title: `${m.name}'s affiliate rate ${m.onFile == null ? "isn't set" : `is ${m.onFile}%`}, not ${m.expected}%`,
      detail: m.from === "commission_pct" ? "From their old commission % on the profile." : null,
      amount: null,
      href: PANEL_HREF.finance,
      action: null,
      at: null,
    });
  }
  return items;
}

export async function complianceItems(organizationId: string, now = new Date()): Promise<BackOfficeItem[]> {
  const settings = await loadBackOfficeSettingsAdmin(organizationId);
  const { obligations } = await listObligations(organizationId, settings.reminderDays, now);
  const today = businessToday(now);
  const items: BackOfficeItem[] = [];
  for (const o of obligations) {
    if (!o.active || !o.dueOn) continue;
    const left = daysUntil(o.dueOn, today);
    if (left < 0) {
      items.push({
        key: `compliance:${o.id}:${o.dueOn}:overdue`,
        kind: "compliance_overdue",
        type: "exception",
        title: `Overdue: ${o.title}`,
        detail: `Was due ${o.dueOn}.${o.dateConfirmed ? "" : " The date is a default: confirm it."}`,
        amount: null,
        href: PANEL_HREF.settings,
        action: null,
        at: o.dueOn,
      });
    } else if (left <= EXPIRY_WARNING_DAYS) {
      items.push({
        key: `compliance:${o.id}:${o.dueOn}:soon`,
        kind: "compliance_due_soon",
        type: "exception",
        title: `${o.title} due in ${left} day${left === 1 ? "" : "s"}`,
        detail: `Due ${o.dueOn}.${o.dateConfirmed ? "" : " The date is a default: confirm it."}`,
        amount: null,
        href: PANEL_HREF.settings,
        action: null,
        at: o.dueOn,
      });
    }
  }
  return items;
}

export async function peopleItems(organizationId: string, now = new Date()): Promise<BackOfficeItem[]> {
  const [{ checklists }, problems] = await Promise.all([listChecklists(organizationId, now), roleProblems(organizationId)]);
  const items: BackOfficeItem[] = [];
  for (const c of checklists) {
    for (const i of c.items.filter((x) => x.overdue)) {
      items.push({
        key: `onboarding:${i.id}:overdue`,
        kind: "onboarding_overdue",
        type: "exception",
        title: `${c.name}: ${i.label}`,
        detail: `Was due ${i.dueOn}.`,
        amount: null,
        href: PANEL_HREF.teamAccess,
        action: null,
        at: i.dueOn,
      });
    }
  }
  for (const p of problems.filter((x) => x.problem !== "legacy")) {
    items.push({
      key: `role:${p.profileId}:${p.problem}`,
      kind: "role_unmapped",
      type: "exception",
      title: `${p.name}: ${p.problem === "unmapped" ? "no role the app recognises" : "roles conflict"}`,
      detail: p.detail,
      amount: null,
      href: PANEL_HREF.teamAccess,
      action: null,
      at: null,
    });
  }
  return items;
}

/** All of it, for the unified queue. Each part fails on its own: one broken table does not hide the rest. */
export async function backOfficeQueueItems(organizationId: string, now = new Date()): Promise<BackOfficeItem[]> {
  const parts = await Promise.all([
    commissionItems(organizationId).catch(() => []),
    complianceItems(organizationId, now).catch(() => []),
    peopleItems(organizationId, now).catch(() => []),
  ]);
  return parts.flat();
}
