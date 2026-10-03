import { createAdminClient } from "@/lib/supabase/admin";
import { looksLikeRawId } from "@/lib/zone-scope";
import type { JobProposal } from "@/types/domain";

export interface PublicProposal {
  proposal: JobProposal;
  /** Service names by their type id, so a proposal snapshotted while the
   * label lookup was broken still shows a name rather than a uuid. */
  serviceNames: Record<string, string>;
  propertyAddress: string;
  customerName: string;
  organizationName: string;
}

/**
 * Whether the services table needs reading at all.
 *
 * Only proposals snapshotted while the label lookup was broken carry a raw id
 * in `serviceLabel`, and only those need the names fetched to repair them.
 * Every other proposal — which is nearly all of them — was paying for a query
 * whose answer it then ignored.
 */
export function needsServiceNames(scopeSnapshot: unknown): boolean {
  if (!Array.isArray(scopeSnapshot)) return false;
  return scopeSnapshot.some((zone) => {
    const label = (zone as { serviceLabel?: unknown })?.serviceLabel;
    return typeof label === "string" && looksLikeRawId(label);
  });
}

/** The shape the one-query version comes back as, when it works. */
interface EmbeddedProposal {
  job_id: string;
  jobs: {
    property_id: string;
    properties: {
      address: string;
      customer_id: string;
      customers: {
        name: string;
        organization_id: string;
        organizations: { name: string } | null;
      } | null;
    } | null;
  } | null;
}

/**
 * A sent proposal, by the token in the client's link.
 *
 * This used to walk the chain a query at a time — proposal, job, property,
 * customer, organization, services — each round trip waiting on the id from
 * the one before it, and a seventh in the page for messages. Seven trips to
 * a database in another building is most of a second before a client sees
 * anything, on the one page in the app where that matters most.
 *
 * It is one query now, following the foreign keys in a single request. With a
 * fallback to the old chain, deliberately: these links are already out in the
 * world, and a proposal that will not open because an embed stopped resolving
 * is worse than a slow one. The worst case is what it did before.
 */
export async function getProposalByToken(token: string): Promise<PublicProposal | null> {
  const admin = createAdminClient();

  const { data: proposal, error } = await admin
    .from("job_proposals")
    .select(
      "*, jobs(property_id, properties(address, customer_id, customers(name, organization_id, organizations(name))))"
    )
    .eq("token", token)
    .maybeSingle();

  // A failure here is not necessarily "no such proposal" — it could be the
  // embed. Fall back rather than telling a client their link is dead.
  if (error) return chainedLookup(token);
  if (!proposal) return null;

  const embedded = proposal as unknown as EmbeddedProposal;
  const property = embedded.jobs?.properties;
  const customer = property?.customers;

  // The embed resolved to nothing where the chain would have found rows. Only
  // the old path can tell "this proposal has no property" from "the embed did
  // not work", and getting that wrong shows a client a broken page.
  if (!property) return chainedLookup(token);

  return {
    proposal: proposal as unknown as JobProposal,
    serviceNames: await serviceNamesFor(
      proposal as { scope_snapshot?: unknown },
      customer?.organization_id
    ),
    propertyAddress: property.address,
    customerName: customer?.name ?? "",
    organizationName: customer?.organizations?.name ?? "",
  };
}

/**
 * The names needed to repair raw ids in an old snapshot.
 *
 * Skipped entirely when the snapshot has no raw ids in it, which is the
 * normal case — one fewer round trip on every proposal a client opens.
 */
async function serviceNamesFor(
  proposal: { scope_snapshot?: unknown },
  organizationId: string | undefined
): Promise<Record<string, string>> {
  if (!organizationId) return {};
  if (!needsServiceNames(proposal.scope_snapshot)) return {};

  const admin = createAdminClient();
  const { data } = await admin
    .from("services")
    .select("service_type_id, name")
    .eq("organization_id", organizationId);

  const serviceNames: Record<string, string> = {};
  for (const row of (data ?? []) as { service_type_id: string; name: string }[]) {
    serviceNames[row.service_type_id] = row.name;
  }
  return serviceNames;
}

/**
 * The original one-at-a-time walk, kept as the safety net.
 *
 * Slower by several round trips and correct in every case the embed might
 * not cover. A sent proposal has to open.
 */
async function chainedLookup(token: string): Promise<PublicProposal | null> {
  const admin = createAdminClient();

  const { data: proposal, error } = await admin
    .from("job_proposals")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) return null;

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("property_id")
    .eq("id", proposal.job_id)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) return null;

  const { data: property, error: propertyError } = await admin
    .from("properties")
    .select("address, customer_id")
    .eq("id", job.property_id)
    .maybeSingle();
  if (propertyError) throw propertyError;
  if (!property) return null;

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("name, organization_id")
    .eq("id", property.customer_id)
    .maybeSingle();
  if (customerError) throw customerError;

  const { data: org, error: orgError } = customer
    ? await admin.from("organizations").select("name").eq("id", customer.organization_id).maybeSingle()
    : { data: null, error: null };
  if (orgError) throw orgError;

  return {
    proposal: proposal as unknown as JobProposal,
    serviceNames: await serviceNamesFor(
      proposal as { scope_snapshot?: unknown },
      customer?.organization_id
    ),
    propertyAddress: property.address,
    customerName: customer?.name ?? "",
    organizationName: org?.name ?? "",
  };
}
