import type { createAdminClient } from "@/lib/supabase/admin";
import { quoteOrder, saltSettingsFrom } from "@/lib/salt";
import { isSalting, saltingOrder } from "@/lib/salting";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * A paid proposal with salting on it, put on the salt route.
 *
 * Salting sold off a site map is the same product as salting bought off the
 * salt page, and it has to land in the same place: the salt route, where it
 * counts toward the salt to buy ahead and the treatments owed. One order per
 * salting area, priced as the proposal priced it. Written once per job: a
 * second payment on the same proposal, or a webhook delivered twice, finds
 * the order already there.
 *
 * Never throws: a payment is recorded whether or not this works, and a
 * failure is logged for somebody to put right by hand.
 */
export async function saltOrdersForPaidProposal(admin: Admin, proposalId: string): Promise<void> {
  try {
    const { data: proposal } = await admin.from("job_proposals").select("job_id, organization_id, scope_snapshot").eq("id", proposalId).maybeSingle();
    if (!proposal?.job_id) return;

    const [{ data: design }, { data: existing }] = await Promise.all([
      admin.from("canvas_designs").select("zones").eq("job_id", proposal.job_id).maybeSingle(),
      admin.from("salt_orders").select("id").eq("job_id", proposal.job_id).limit(1),
    ]);
    if ((existing ?? []).length > 0) return;
    const zones = ((design?.zones ?? []) as unknown as { name?: string; service?: { typeId?: string; values?: Record<string, string> } | null }[]).filter((z) =>
      isSalting(z.service?.typeId)
    );
    if (zones.length === 0) return;
    const snapshot = ((proposal as { scope_snapshot?: unknown }).scope_snapshot ?? []) as { zoneName?: string; priceCents?: number | null }[];

    const [{ data: org }, { data: job }] = await Promise.all([
      admin.from("organizations").select("*").eq("id", proposal.organization_id).maybeSingle(),
      admin.from("jobs").select("property_id, property:properties(id, address, lat, lng, customer:customers(id, name, email, phone))").eq("id", proposal.job_id).maybeSingle(),
    ]);
    const settings = saltSettingsFrom(org as Record<string, unknown> | null);
    const property = (job as unknown as {
      property: { id: string; address: string | null; lat: number | null; lng: number | null; customer: { id: string; name: string | null; email: string | null; phone: string | null } | null } | null;
    } | null)?.property;
    const now = new Date().toISOString();

    const { error } = await admin.from("salt_orders").insert(
      zones.map((zone) => {
        const order = saltingOrder(zone.service?.values);
        const quote = quoteOrder(order, settings);
        // What the client paid for it on the proposal, when the proposal
        // priced it over the salt page (travel, whole hours, the floor).
        const sold = snapshot.find((s) => s.zoneName === zone.name)?.priceCents;
        const amount = sold != null && sold > 0 ? sold : quote.totalCents;
        return {
          organization_id: proposal.organization_id,
          name: property?.customer?.name ?? "Client",
          email: property?.customer?.email ?? "",
          phone: property?.customer?.phone ?? null,
          address: property?.address ?? "",
          lat: property?.lat ?? null,
          lng: property?.lng ?? null,
          surface: quote.surface,
          pet_friendly: quote.petFriendly,
          treatments: quote.treatments,
          treatments_used: 0,
          per_treatment_cents: Math.round(amount / Math.max(1, quote.treatments)),
          amount_cents: amount,
          status: "paid",
          paid_at: now,
          customer_id: property?.customer?.id ?? null,
          property_id: property?.id ?? null,
          job_id: proposal.job_id,
          note: `From the proposal${zone.name ? `, ${zone.name}` : ""}`,
        };
      })
    );
    if (error) console.error("[salt] order from proposal failed:", proposalId, error.message);
  } catch (err) {
    console.error("[salt] order from proposal failed:", proposalId, err);
  }
}
