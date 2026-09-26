"use client";

import { useRef, useState, useTransition } from "react";
import { v4 as uuid } from "uuid";
import { ImageUp, Loader2, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { updateToolImage } from "@/lib/actions/tool-actions";

function publicUrlFor(storagePath: string): string {
  const supabase = createClient();
  return supabase.storage.from("tool-images").getPublicUrl(storagePath).data.publicUrl;
}

export function ToolImageUpload({ toolId, imagePath }: { toolId: string; imagePath: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const path = `${toolId}/${uuid()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("tool-images").upload(path, file, {
        upsert: false,
      });
      if (uploadError) throw uploadError;
      await updateToolImage(toolId, path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleRemove() {
    startTransition(() => updateToolImage(toolId, null));
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-14 w-14 shrink-0">
        {imagePath ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={publicUrlFor(imagePath)}
              alt=""
              className="h-14 w-14 rounded-md border border-border object-cover"
            />
            <button
              type="button"
              onClick={handleRemove}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
            <span className="text-[9px]">Photo</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}
