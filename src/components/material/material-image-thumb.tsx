"use client";

import { createClient } from "@/lib/supabase/client";

export function MaterialImageThumb({ imagePath }: { imagePath: string | null }) {
  if (!imagePath) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md bg-muted text-xl">
        <span aria-hidden>📦</span>
      </div>
    );
  }

  const supabase = createClient();
  const url = supabase.storage.from("material-images").getPublicUrl(imagePath).data.publicUrl;

  return (
    <div className="h-full w-full overflow-hidden rounded-md bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
    </div>
  );
}
