"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { ImageUp, Loader2, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

const BUCKET = "knowledge-images";

export function knowledgeImageUrl(storagePath: string): string {
  return createClient().storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

/**
 * A photo on a graph node.
 *
 * Uploads straight to the bucket from the browser and reports back the path,
 * rather than posting the file through a Server Action — a photo off a phone
 * camera is regularly over the request body limit, and the failure that
 * produces is a generic 413 nobody can act on.
 *
 * Deliberately usable before the node exists: capturing a problem starts with
 * a photo of it far more often than with a sentence about it, so the picture
 * is taken first and the row is written around it.
 */
export function NodeImage({
  path,
  onChange,
  size = "md",
  label = "Photo",
}: {
  path: string | null;
  onChange: (path: string | null) => void;
  size?: "sm" | "md";
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const box = size === "sm" ? "h-12 w-12" : "h-20 w-20";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      // Foldered by day rather than by node: the node may not exist yet, and
      // a flat bucket of ten thousand files is one nobody can ever tidy.
      const day = new Date().toISOString().slice(0, 10);
      const storagePath = `${day}/${uuid()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, { upsert: false });
      if (uploadError) throw uploadError;
      onChange(storagePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className={`relative shrink-0 ${box}`}>
        {path ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={knowledgeImageUrl(path)}
              alt=""
              className={`${box} rounded-md border border-border object-cover`}
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"
              aria-label="Remove photo"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`${box} flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent disabled:opacity-50`}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageUp className="h-4 w-4" />
            )}
            <span className="text-[9px]">{label}</span>
          </button>
        )}
      </div>
      {/* Capture rather than a library pick on a phone, because the thing
          being photographed is usually in front of the person. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}
