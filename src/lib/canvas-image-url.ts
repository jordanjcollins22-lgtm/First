import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

// The "canvas-images" bucket is public — getPublicUrl is a pure URL
// construction, no auth or network call needed, so a bare anon-key client
// works fine here (including from public, unauthenticated pages).
//
// Built on first use rather than at module load: createClient throws without
// credentials, and a page that merely imports this would otherwise fail to
// build in any environment that has none.
let storageClient: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!storageClient) storageClient = createClient(env.supabaseUrl, env.supabaseAnonKey);
  return storageClient;
}

export function canvasImageUrl(path: string): string {
  return client().storage.from("canvas-images").getPublicUrl(path).data.publicUrl;
}
