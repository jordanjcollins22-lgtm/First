function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env.local and fill it in.`
    );
  }
  return value;
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "",
};

/** Server-only secrets. Never import these into client components. */
export const serverEnv = {
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ghlApiKey: process.env.GHL_API_KEY ?? "",
  ghlLocationId: process.env.GHL_LOCATION_ID ?? "",
  ghlWebhookSecret: process.env.GHL_WEBHOOK_SECRET ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /**
   * How the comms agent answers customers. "draft" (default): it writes the
   * reply and a manager approves it in /inbox or by texting back. "auto": it
   * sends routine replies itself and still escalates anything sensitive.
   */
  agentCustomerMode: (process.env.AGENT_CUSTOMER_MODE === "auto" ? "auto" : "draft") as "auto" | "draft",
};

/** Public base URL of the app, used to build the links texted to employees. */
export function appBaseUrl(): string {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export function isGhlConfigured() {
  return Boolean(serverEnv.ghlApiKey && serverEnv.ghlLocationId);
}

export function assertSupabaseConfigured() {
  required("NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl);
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", env.supabaseAnonKey);
}

export function assertMapboxConfigured() {
  required("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", env.mapboxToken);
}

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const isMapboxConfigured = Boolean(env.mapboxToken);
