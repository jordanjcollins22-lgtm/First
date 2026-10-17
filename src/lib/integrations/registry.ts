import type { IntegrationProvider } from "@/lib/integrations/types";
import { googleBusinessProvider } from "@/lib/integrations/providers/google_business";
import { googleAdsProvider } from "@/lib/integrations/providers/google_ads";
import { googleLsaProvider } from "@/lib/integrations/providers/google_lsa";
import { googlePlacesProvider } from "@/lib/integrations/providers/google_places";
import { quickbooksProvider } from "@/lib/integrations/providers/quickbooks";
import { payrollProvider } from "@/lib/integrations/providers/payroll";
import { discordProvider } from "@/lib/integrations/providers/discord";

/**
 * Every integration the Integrations page lists, in the order it shows them.
 * Each provider lives in its own file under ./providers.
 */
export const PROVIDERS: IntegrationProvider[] = [
  googleBusinessProvider,
  googleAdsProvider,
  googleLsaProvider,
  googlePlacesProvider,
  quickbooksProvider,
  payrollProvider,
  discordProvider,
];

export function providerById(id: string): IntegrationProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
