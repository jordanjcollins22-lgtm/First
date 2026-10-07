import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getMaterialSuppliers } from "@/lib/data/material-suppliers";
import { createClient } from "@/lib/supabase/server";
import { isOwnerLevel } from "@/lib/roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { SuppliersEditor } from "@/components/suppliers/suppliers-editor";

/**
 * Bulk suppliers: where to get mulch, topsoil and stone near the work, what
 * each charges a yard or ton, and what delivery costs to each town. The price
 * card recommends the closest one with a price from these.
 */
export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("suppliers", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const { suppliers, available } = await getMaterialSuppliers(supabase, profile.organization_id, { includeInactive: true });
  const canEdit = isOwnerLevel(profile.roles) || profile.roles.includes("admin");
  return <SuppliersEditor initial={suppliers} available={available} canEdit={canEdit} />;
}
