import { findLocation } from "@/lib/google/business";
import { googleAccessToken } from "@/lib/google/oauth";
import type { IntegrationProvider } from "@/lib/integrations/types";

/**
 * Google Business Profile: reviews pulled daily and answered, the weekly
 * before-and-after post, and calls / directions / website clicks.
 */
export const googleBusinessProvider: IntegrationProvider = {
  id: "google_business",
  name: "Google Business Profile",
  area: "Marketing",
  enables: "Reviews pulled every day and answered, a weekly photo post, and calls, direction requests and website clicks from the listing.",
  fields: [
    { key: "client_id", label: "OAuth client ID", placeholder: "1234-abc.apps.googleusercontent.com" },
    { key: "client_secret", label: "OAuth client secret", secret: true },
    {
      key: "location_id",
      label: "Location ID (optional)",
      placeholder: "locations/1234567890",
      help: "Only if the sign-in manages more than one listing. Left empty, the first listing is used.",
    },
  ],
  howTo: [
    "In Google Cloud Console (console.cloud.google.com), make a project and enable the My Business Account Management, My Business Business Information, Google My Business and Business Profile Performance APIs.",
    "Business Profile APIs need access approved by Google: request it at developers.google.com/my-business/content/prereqs (usually a few days).",
    "APIs & Services › OAuth consent screen: External, and add your own Google account as a test user.",
    "APIs & Services › Credentials › Create credentials › OAuth client ID › Web application. Add the authorized redirect URI https://app.jslandscapingmd.com/api/integrations/google_business/callback.",
    "Paste the client ID and secret here, save, then press Connect and sign in with the Google account that owns the Business Profile.",
  ],
  docsUrl: "https://developers.google.com/my-business/content/basic-setup",
  oauthStartPath: "/api/integrations/google_business/start",
  async test(secrets) {
    const auth = await googleAccessToken(secrets);
    if (!auth.ok) return { ok: false, error: auth.error };
    const loc = await findLocation(auth.token, secrets.location_id || null);
    return loc.ok ? { ok: true } : { ok: false, error: loc.error };
  },
};
