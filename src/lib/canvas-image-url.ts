import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

// The "canvas-images" bucket is public — getPublicUrl is a pure URL
// construction, no auth or network call needed, so a bare anon-key client
// works fine here (including from public, unauthenticated pages).
const storageClient = createClient(env.supabaseUrl, env.supabaseAnonKey);

export function canvasImageUrl(path: string): string {
  return storageClient.storage.from("canvas-images").getPublicUrl(path).data.publicUrl;
}
