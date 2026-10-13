import type { NextRequest } from "next/server";

import { finishGoogleOAuth } from "@/lib/google/oauth-routes";

/** Where Google sends the owner back after signing in for google_ads. */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return finishGoogleOAuth("google_ads", request);
}
