import { startGoogleOAuth } from "@/lib/google/oauth-routes";

/** "Connect" for google_ads: off to Google to sign in, back to ./callback. */
export const dynamic = "force-dynamic";

export async function GET() {
  return startGoogleOAuth("google_ads");
}
