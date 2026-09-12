import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { viewsForAllProposals } from "@/lib/data/proposal-views";
import { attentionForAllProposals } from "@/lib/data/proposal-attention";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isOwnerLevel } from "@/lib/roles";
import type { ViewSummary } from "@/lib/proposal-views";
import type { AttentionSummary } from "@/lib/proposal-attention";
import { buildCallList, isCallOutcome, type CallItem, type CallList, type PreviousCall } from "@/lib/call-list";
import type { Profile, ProposalZoneSnapshot } from "@/types/domain";

/**
 * Who this person should be ringing.
 *
 * An account manager sees their own clients and every client nobody has
 * claimed yet, because an unclaimed proposal is one nobody is ringing.
 * Recording a call claims it. An owner or admin sees the lot.
 */
export async function getCallList(profile: Profile, today: Date = new Date()): Promise<CallList> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const { data: rows } = await supabase
    .from("job_proposals")
    .select(
      "id, job_id, status, total_cost, approved_at, responded_at, client_response_note, scope_snapshot, job:jobs(id, status, declined_at, cancelled_at, property:properties(address, customer:customers(id, name, phone, account_manager_id, do_not_contact)))"
    )
    .eq("organization_id", organizationId)
    .in("status", ["sent", "declined"])
    .order("approved_at", { ascending: false })
    .limit(200);

  const proposals = ((rows ?? []) as unknown as {
    id: string;
    job_id: string;
    status: "sent" | "declined";
    total_cost: number | null;
    approved_at: string | null;
    responded_at: string | null;
    client_response_note: string | null;
    scope_snapshot: ProposalZoneSnapshot[] | null;
    job: {
      id: string;
      status: string;
      declined_at: string | null;
      cancelled_at: string | null;
      property: {
        address: string;
        customer: { id: string; name: string; phone: string | null; account_manager_id: string | null; do_not_contact: boolean } | null;
      } | null;
    } | null;
  }[]).filter((p) => p.job && p.job.status !== "cancelled" && !p.job.cancelled_at);

  const seesAll = isOwnerLevel(profile.roles) || profile.roles.includes("admin");
  const mine = proposals.filter((p) => {
    const customer = p.job?.property?.customer;
    if (!customer || customer.do_not_contact) return false;
    if (seesAll) return true;
    if (!isAccountManager(profile.roles)) return false;
    return customer.account_manager_id === profile.id || customer.account_manager_id == null;
  });
  if (mine.length === 0) return buildCallList([], today);

  const ids = mine.map((p) => p.id);
  const [{ data: callRows }, { data: objectionRows }, views, attention] = await Promise.all([
    supabase
      .from("proposal_calls")
      .select("proposal_id, outcome, note, callback_on, created_at, profile:profiles(full_name, email)")
      .in("proposal_id", ids)
      .order("created_at", { ascending: false }),
    supabase.from("proposal_objections").select("proposal_id, objection_id, raised_at").in("proposal_id", ids),
    viewsForAllProposals().catch(() => ({}) as Record<string, ViewSummary>),
    attentionForAllProposals().catch(() => ({}) as Record<string, AttentionSummary>),
  ]);

  const callsByProposal = new Map<string, PreviousCall[]>();
  for (const row of (callRows ?? []) as unknown as {
    proposal_id: string;
    outcome: string;
    note: string | null;
    callback_on: string | null;
    created_at: string;
    profile: { full_name: string | null; email: string | null } | null;
  }[]) {
    if (!isCallOutcome(row.outcome)) continue;
    const list = callsByProposal.get(row.proposal_id) ?? [];
    list.push({
      at: row.created_at,
      outcome: row.outcome,
      note: row.note,
      byName: row.profile?.full_name || row.profile?.email || null,
      callbackOn: row.callback_on,
    });
    callsByProposal.set(row.proposal_id, list);
  }

  const objectionsByProposal = new Map<string, string[]>();
  for (const row of (objectionRows ?? []) as { proposal_id: string; objection_id: string }[]) {
    const list = objectionsByProposal.get(row.proposal_id) ?? [];
    if (!list.includes(row.objection_id)) list.push(row.objection_id);
    objectionsByProposal.set(row.proposal_id, list);
  }

  const items: CallItem[] = mine.map((p) => {
    const customer = p.job!.property!.customer!;
    const view = views[p.id];
    const focus = attention[p.id];
    return {
      proposalId: p.id,
      jobId: p.job_id,
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      address: p.job?.property?.address ?? "",
      status: p.status,
      totalCents: p.total_cost != null ? Math.round(Number(p.total_cost) * 100) : null,
      sentAt: p.approved_at,
      respondedAt: p.responded_at,
      responseNote: p.client_response_note,
      opens: view?.opens ?? 0,
      lastOpenAt: view?.lastAt ?? null,
      focus: focus && !focus.thin ? (focus.focus?.label ?? null) : null,
      objectionIds: objectionsByProposal.get(p.id) ?? [],
      services: [...new Set((p.scope_snapshot ?? []).map((z) => z.serviceLabel).filter(Boolean))],
      accountManagerId: customer.account_manager_id,
      calls: callsByProposal.get(p.id) ?? [],
    };
  });

  return buildCallList(items, today);
}
