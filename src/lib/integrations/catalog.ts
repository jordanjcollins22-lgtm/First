import { accessTokenFor } from "@/lib/integrations/oauth";
import { payrollProvider } from "@/lib/integrations/providers/payroll";
import { quickbooksProvider } from "@/lib/integrations/providers/quickbooks";
import { PROVIDERS } from "@/lib/integrations/registry";
import type { IntegrationProvider } from "@/lib/integrations/types";

/**
 * Every provider the Integrations page lists: the registry, plus this
 * workstream's own until the registry carries them (then the registry's copy
 * wins and these drop out as duplicates).
 */
const LOCAL: IntegrationProvider[] = [quickbooksProvider, payrollProvider];

export function allProviders(): IntegrationProvider[] {
  const seen = new Set<string>();
  return [...PROVIDERS, ...LOCAL].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

export function findProvider(id: string): IntegrationProvider | undefined {
  return allProviders().find((p) => p.id === id);
}

/**
 * Refreshes the saved token before a Test, so a token that expired overnight
 * isn't reported as broken. Uses the provider's own `oauthConfig`; a provider
 * without one is tested with the token as saved.
 */
export async function freshenToken(organizationId: string, providerId: string): Promise<void> {
  const resolver = findProvider(providerId)?.oauthConfig;
  if (resolver) await accessTokenFor(organizationId, providerId, resolver);
}
