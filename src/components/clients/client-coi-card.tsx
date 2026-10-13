import { getRealProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { listClientCois } from "@/lib/data/compliance";
import { ClientCoiForm } from "./client-coi-form";

/**
 * Certificate of insurance, on a client's page. For commercial clients and
 * property managers who ask for one before work starts. Owner-level only:
 * it states the business's coverage on its behalf. Renders nothing for
 * anybody else, or before the back-office tables exist.
 */
export async function ClientCoiCard({ customerId, customerName }: { customerId: string; customerName: string }) {
  const profile = await getRealProfile();
  if (!profile || !isOwnerLevel(profile.roles)) return null;
  const cois = await listClientCois(profile.organization_id, customerId).catch(() => []);
  return (
    <div className="rounded-2xl border border-white/60 bg-card/70 p-6 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
      <h3 className="text-lg font-bold">Certificate of insurance</h3>
      <p className="mb-3 text-sm text-muted-foreground">For a commercial client who asks. Prints the policies on the compliance calendar, with them as certificate holder, and emails a link.</p>
      <ClientCoiForm customerId={customerId} defaultHolder={customerName} cois={cois} />
    </div>
  );
}
