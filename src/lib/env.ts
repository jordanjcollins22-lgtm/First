function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env.local and fill it in.`
    );
  }
  return value;
}

export const env = {
  /** An explicit override for the domain links are built from. Only needed
   * when the automatic answer below is wrong. */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  /** Set by Vercel on every deployment: the project's production domain, which
   * is the custom domain once one is attached. Nothing to configure. */
  productionDomain: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "",
  rentcastApiKey: process.env.RENTCAST_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  /** Needed in the browser to draw Apple Pay, Google Pay and the card form.
   * Public by design: it can only start a payment we have already priced. */
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  // Harford County's ArcGIS REST endpoint: the address layer, or the service
  // or catalog above it, in which case the app finds the layer itself. Unset
  // means the county's public catalog, and discovery does the rest.
  harfordGisUrl: process.env.HARFORD_GIS_URL ?? "",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "",
  livekitUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // Where an approved post is handed off to be published — Zapier, Make,
  // Buffer, anything that takes a JSON body. Unset means posts still get a
  // time, they just wait for somebody to press send.
  socialWebhookUrl: process.env.SOCIAL_WEBHOOK_URL ?? "",
  // Google Places, for checking where we come in local results from a given
  // point. Unset means the grid is filled in by hand instead.
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
  // Which listing is ours. Without it a scan cannot tell us apart from
  // another landscaper with a similar name.
  googlePlaceId: process.env.GOOGLE_PLACE_ID ?? "",
  // Sends our email. Which domains and which addresses are set up in the app
  // rather than here — those change, and a redeploy to add an address is a
  // reason nobody adds the address.
  resendApiKey: process.env.RESEND_API_KEY ?? "",
};

export function assertSupabaseConfigured() {
  required("NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl);
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", env.supabaseAnonKey);
}

export function assertMapboxConfigured() {
  required("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", env.mapboxToken);
}

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const isSupabaseAdminConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
export const isMapboxConfigured = Boolean(env.mapboxToken);
export const isRentcastConfigured = Boolean(env.rentcastApiKey);
export const isAnthropicConfigured = Boolean(env.anthropicApiKey);
export const isTwilioConfigured = Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioPhoneNumber);
export const isStripeConfigured = Boolean(env.stripeSecretKey);
/**
 * Whether a client can pay without leaving our page.
 *
 * The secret key alone is enough to raise a hosted checkout and send them to
 * it. Paying in place, with the wallet sheet their phone already has their
 * card in, also needs the publishable key in the browser.
 */
export const isStripeInPageReady = Boolean(env.stripeSecretKey && env.stripePublishableKey);
export const isLivekitConfigured = Boolean(env.livekitApiKey && env.livekitApiSecret && env.livekitUrl);
/** Sending email at all. Domains and addresses are configured in the app. */
export const isResendConfigured = Boolean(env.resendApiKey);
/** Transcribes voice memos. Without it a memo still records and plays, just untranscribed. */
export const isTranscriptionConfigured = Boolean(env.openaiApiKey);
