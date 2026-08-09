"use client";

import { useRef, useState, useTransition } from "react";
import { v4 as uuid } from "uuid";
import { Camera, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { recordPhoto, deletePhoto } from "@/lib/actions/photo-actions";
import type { Photo } from "@/types/domain";

interface PhotoUploaderProps {
  workAreaId: string;
  photos: Photo[];
  requiredCount: number;
  onChanged: () => void;
}

function publicUrlFor(storagePath: string): string {
  const supabase = createClient();
  return supabase.storage.from("work-area-photos").getPublicUrl(storagePath).data
    .publicUrl;
}

export function PhotoUploader({
  workAreaId,
  photos,
  requiredCount,
  onChanged,
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      for (const file of Array.from(files)) {
        const path = `${workAreaId}/${uuid()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("work-area-photos")
          .upload(path, file, { upsert: false });
        if (uploadError) throw uploadError;
        await recordPhoto(workAreaId, path, "reference");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDelete(photoId: string) {
    startTransition(async () => {
      await deletePhoto(photoId);
      onChanged();
    });
  }

  const remaining = Math.max(0, requiredCount - photos.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Photos ({photos.length}
          {requiredCount > 0 ? ` / ${requiredCount} required` : ""})
        </p>
        {remaining > 0 && (
          <span className="text-xs text-destructive">{remaining} more needed</span>
        )}
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-md border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={publicUrlFor(photo.storage_path)}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => handleDelete(photo.id)}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="secondary"
        size="lg"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
        {uploading ? "Uploading..." : "Add Photos"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
