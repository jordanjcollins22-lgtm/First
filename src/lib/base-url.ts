import { headers } from "next/headers";

import { env } from "@/lib/env";
import { resolveBaseUrl } from "@/lib/app-url";

/**
 * The address to put in a link somebody outside the app will follow.
 *
 * Server-side wrapper around resolveBaseUrl, so the several places that need
 * an absolute URL do not each reach for headers() and get the order of the
 * fallbacks subtly different. Stripe in particular refuses a relative
 * success_url, so a checkout built from an unset env var fails outright.
 */
export async function outboundBaseUrl(): Promise<string> {
  const list = await headers();
  return resolveBaseUrl({
    configured: env.appUrl,
    productionDomain: env.productionDomain,
    host: list.get("host"),
    proto: list.get("x-forwarded-proto"),
  });
}
