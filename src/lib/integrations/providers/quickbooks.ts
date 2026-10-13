import { qboClientWith, QboError, quickbooksOAuth } from "@/lib/integrations/quickbooks/api";
import type { IntegrationProvider } from "@/lib/integrations/types";

/**
 * QuickBooks Online: the books. The app pushes its customers, invoices and
 * payments there every hour, one way, so the bookkeeper never retypes them.
 */
export const quickbooksProvider: IntegrationProvider = {
  id: "quickbooks",
  name: "QuickBooks Online",
  area: "Admin",
  enables: "Customers, invoices and payments copied into QuickBooks every hour, one way.",
  fields: [
    { key: "client_id", label: "Client ID", placeholder: "ABc1…", help: "From your Intuit app's Keys & credentials." },
    { key: "client_secret", label: "Client secret", secret: true },
    {
      key: "environment",
      label: "Environment",
      placeholder: "production",
      help: "Type sandbox to try it against Intuit's test company first; anything else means your real books.",
    },
    {
      key: "item_id",
      label: "Sales item ID",
      placeholder: "1",
      help: "The QuickBooks Product/Service invoices are booked to. Leave blank for the first one (usually \"Services\").",
    },
  ],
  howTo: [
    "Go to developer.intuit.com and sign in with the Intuit account that owns your QuickBooks company.",
    "Dashboard → Create an app → QuickBooks Online and Payments. Name it \"JS Landscaping app\" and tick the Accounting scope.",
    "Open the app → Keys & credentials. Use Production keys for your real books (Intuit asks a short questionnaire first) or Development keys with a sandbox company to try it.",
    "Under Redirect URIs, add exactly: <your app address>/api/integrations/quickbooks/callback — e.g. https://app.jslandscapingmd.com/api/integrations/quickbooks/callback.",
    "Copy the Client ID and Client secret here and press Save.",
    "Press Connect, sign in to Intuit and pick your company. Then turn the sync on under Admin › Finance.",
  ],
  docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0",
  oauthStartPath: "/api/integrations/quickbooks/start",
  oauthConfig: quickbooksOAuth,
  async test(secrets, settings) {
    const realmId = typeof settings.realm_id === "string" ? settings.realm_id : "";
    if (!secrets.access_token || !realmId) return { ok: false, error: "Not connected yet — press Connect." };
    try {
      const client = qboClientWith(secrets.access_token, realmId, settings.environment);
      await client.request("GET", `companyinfo/${encodeURIComponent(realmId)}`);
      return { ok: true };
    } catch (err) {
      if (err instanceof QboError && err.status === 401) return { ok: false, error: "Sign-in expired — press Connect again." };
      return { ok: false, error: err instanceof Error ? err.message : "QuickBooks didn't answer." };
    }
  },
};
