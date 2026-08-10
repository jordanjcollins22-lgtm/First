"use client";

import { createClient } from "@/lib/supabase/client";

export function ToolImageThumb({ imagePath, icon }: { imagePath: string | null; icon: string }) {
  if (!imagePath) {
    return (
      <div className="flex aspect-square items-center justify-center bg-muted text-4xl">
        <span aria-hidden>{icon}</span>
      </div>
    );
  }

  const supabase = createClient();
  const url = supabase.storage.from("tool-images").getPublicUrl(imagePath).data.publicUrl;

  return (
    <div className="aspect-square bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
    </div>
  );
}
