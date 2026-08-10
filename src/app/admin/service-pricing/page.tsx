import { listServicePricing } from "@/lib/data/service-pricing";
import { isSupabaseConfigured } from "@/lib/env";
import { SERVICE_TYPES } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ServicePricingRow } from "@/components/service-pricing/service-pricing-row";

export default async function ServicePricingPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const pricing = await listServicePricing();
  const pricingByType = new Map(pricing.map((p) => [p.service_type_id, p]));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Service Pricing</h1>
      <p className="mb-6 text-muted-foreground">
        Cost and time estimates per service. These appear automatically once a zone
        uses that service, and roll up into the Job Plan&apos;s total estimate.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          {SERVICE_TYPES.map((type) => {
            const p = pricingByType.get(type.id);
            return (
              <ServicePricingRow
                key={type.id}
                serviceTypeId={type.id}
                label={type.label}
                initialCost={p?.cost ?? null}
                initialCostUnit={p?.cost_unit ?? "flat rate"}
                initialEstimatedHours={p?.estimated_hours ?? null}
              />
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
