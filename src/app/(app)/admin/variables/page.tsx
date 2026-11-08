import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getAppFigures, getBusinessVariables, getPriceSources } from "@/lib/data/business-variables";
import { loadBackOfficeSettings } from "@/lib/data/back-office-settings";
import { createClient } from "@/lib/supabase/server";
import { MATERIALS, priceFor } from "@/lib/pricing-materials";
import { NO_APP_FIGURES } from "@/lib/pricing-report";
import { isOwnerLevel } from "@/lib/roles";
import { otherVariables } from "@/lib/variables-registry";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { VariablesForm } from "@/components/pricing/variables-form";

/**
 * Admin › Variables: every internal number on one page. Crew pay, the
 * commission defaults, the capacity multipliers, the indirect cost pool,
 * crew, travel, logistics, condition multipliers and the 97 production
 * rates are edited here; material prices and everything else the app runs
 * on are listed with where each one lives.
 */
export const dynamic = "force-dynamic";

export default async function VariablesPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("variables", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const stored = await getBusinessVariables(supabase, profile.organization_id);
  const [app, sources, backOffice] = await Promise.all([
    getAppFigures(supabase, profile.organization_id, stored.variables).catch(() => NO_APP_FIGURES),
    getPriceSources(supabase, profile.organization_id).catch(() => ({ supplierProducts: [], inventory: [] })),
    loadBackOfficeSettings(supabase, profile.organization_id),
  ]);
  const materials = MATERIALS.map((m) => {
    const p = priceFor(m, sources);
    return { key: m.key, name: m.name, unit: m.unit, needed: 0, order: 0, unitCents: p.unitCents, costCents: null, supplier: p.supplier, source: p.source, areas: [] };
  });
  const canEdit = isOwnerLevel(profile.roles) || profile.roles.includes("admin");
  return (
    <VariablesForm
      initial={stored.variables}
      saved={stored.saved}
      canSave={stored.canSave}
      canEdit={canEdit}
      updatedAt={stored.updatedAt}
      app={app}
      commissions={{
        ready: backOffice.ready,
        defaultAccountManagerPct: backOffice.defaultAccountManagerPct,
        defaultEvaluatorPct: backOffice.defaultEvaluatorPct,
        defaultAffiliatePct: backOffice.defaultAffiliatePct,
        holdbackCollectPct: backOffice.holdbackCollectPct,
        holdbackMarginPct: backOffice.holdbackMarginPct,
        holdbackCrewCostPerHour: backOffice.holdbackCrewCostPerHour,
      }}
      canEditCommissions={isOwnerLevel(profile.roles)}
      materials={materials}
      others={otherVariables()}
    />
  );
}
