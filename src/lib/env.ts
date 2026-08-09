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

export function assertSupabaseConfigured() {
  required("NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl);
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", env.supabaseAnonKey);
}

export function assertMapboxConfigured() {
  required("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", env.mapboxToken);
}

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const isMapboxConfigured = Boolean(env.mapboxToken);
