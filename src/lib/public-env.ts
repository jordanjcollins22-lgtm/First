/**
 * The handful of settings the browser is allowed to know.
 *
 * Everything in here is public by design: a map token that can only draw
 * maps, a Stripe key that can only start a payment we already priced, the
 * address of our own Supabase. The secrets live in lib/env.ts, which is
 * for the server only. A browser component imports this file, never that
 * one, and there is a test that says so.
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "",
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
  livekitUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "",
};

export const isMapboxConfigured = Boolean(publicEnv.mapboxToken);
