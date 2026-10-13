import { oauthStart } from "@/lib/integrations/oauth";
import { quickbooksOAuth, QBO_PROVIDER } from "@/lib/integrations/quickbooks/api";

/** "Connect" on the QuickBooks card: off to Intuit to pick the company. */
export const dynamic = "force-dynamic";

export async function GET() {
  return oauthStart({ provider: QBO_PROVIDER, configFor: quickbooksOAuth });
}
