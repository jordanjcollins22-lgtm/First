import type { IntegrationProvider } from "@/lib/integrations/types";

/**
 * Every integration the Integrations page lists. Each workstream adds its
 * provider file under ./providers and one line here.
 */
export const PROVIDERS: IntegrationProvider[] = [];

export function providerById(id: string): IntegrationProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
