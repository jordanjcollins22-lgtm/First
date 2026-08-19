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
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "",
  livekitUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
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
export const isLivekitConfigured = Boolean(env.livekitApiKey && env.livekitApiSecret && env.livekitUrl);
/** Transcribes voice memos. Without it a memo still records and plays, just untranscribed. */
export const isTranscriptionConfigured = Boolean(env.openaiApiKey);
