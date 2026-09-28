"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Camera, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { setKitPhoto } from "@/lib/actions/kit-photo-actions";

/**
 * A kit's photo on its card: take or pick one, replace it, or take it off.
 * The crew sees this photo when the load-out says to go grab the kit.
 */
export function KitPhotoUpload({ kit, photoUrl, folder }: { kit: number; photoUrl: string | null; folder: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const path = `${folder}kit-${kit}-${uuid()}.${(file.name.split(".").pop() || "jpg").toLowerCase()}`;
      const { error: uploadError } = await createClient().storage.from("tool-images").upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;
      const result = await setKitPhoto(kit, path);
      if (!result.ok) setError(result.message);
      else router.refresh();
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await setKitPhoto(kit, null);
    setBusy(false);
    if (!result.ok) setError(result.message);
    else router.refresh();
  }

  return (
    <div className="mt-2">
      {photoUrl ? (
        <div className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt={`Kit ${kit}`} className="aspect-[4/3] w-full rounded-md border border-border object-cover" />
          <div className="flex gap-3 text-xs">
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="text-primary hover:underline">
              {busy ? "Saving…" : "Change photo"}
            </button>
            <button type="button" disabled={busy} onClick={remove} className="text-muted-foreground hover:underline">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:bg-accent"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          Add a photo of Kit {kit}
          <span className="text-xs">So the crew knows what to grab</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
