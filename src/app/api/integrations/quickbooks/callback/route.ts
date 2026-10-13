import type { NextRequest } from "next/server";

import { oauthCallback } from "@/lib/integrations/oauth";
import { quickbooksOAuth, QBO_PROVIDER } from "@/lib/integrations/quickbooks/api";

/**
 * Where Intuit sends the owner back. The company they picked arrives as
 * realmId next to the code; it is kept with the connection, because every
 * QuickBooks request names the company.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return oauthCallback(request, {
    provider: QBO_PROVIDER,
    configFor: quickbooksOAuth,
    onTokens: async ({ params }) => {
      const realmId = params.get("realmId");
      if (!realmId) throw new Error("Intuit didn't say which company was picked. Press Connect and choose one.");
      return { realm_id: realmId };
    },
  });
}
