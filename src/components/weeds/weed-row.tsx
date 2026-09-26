"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Check, ImageUp, Loader2, Printer, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { addWeedPhoto, removeWeedPhoto, setOnClientSheet, setPrintPhoto, setWeedPrep } from "@/lib/actions/weed-actions";
import type { Weed } from "@/lib/weeds";

function publicUrlFor(path: string): string {
  return createClient().storage.from("weed-photos").getPublicUrl(path).data.publicUrl;
}

/**
 * One weed, as the office keeps it.
 *
 * The photos are all here; one of them wears the printer mark, and that is
 * the one paper gets. Everything else is for the screen a scan opens, where
 * they can be flicked through — which is the whole reason the printed row
 * carries a code.
 */
export function WeedRow({ weed }: { weed: Weed }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState(weed.prep ?? "");
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  /**
   * Photos in, however many were picked.
   *
   * A weed is four different-looking things depending on whether it has
   * flowered, so somebody adding photos is almost never adding one. They go
   * up in the order they were chosen, and the first one to arrive on a weed
   * with none becomes the one that prints.
   */
  async function upload(files: FileList | null) {
    const chosen = Array.from(files ?? []);
    if (chosen.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      for (const file of chosen) {
        const path = `${weed.slug}/${uuid()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("weed-photos").upload(path, file, { upsert: false });
        if (uploadError) throw uploadError;
        const result = await addWeedPhoto({ weedId: weed.id, path });
        if (!result.ok) throw new Error(result.error);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? "That did not save.");
      else router.refresh();
    });
  }

  function savePrep() {
    setError(null);
    startTransition(async () => {
      const result = await setWeedPrep(weed.id, prep);
      if (!result.ok) setError(result.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{weed.common}</p>
          <p className="text-xs italic text-muted-foreground">{weed.scientific}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wider">{weed.code}</span>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={weed.client}
              onChange={(e) => run(() => setOnClientSheet(weed.id, e.target.checked))}
              className="h-3.5 w-3.5"
            />
            On the client sheet
          </label>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-start gap-2">
        {weed.photos.map((photo) => {
          const printing = photo.id === weed.printPhotoId;
          return (
            <div key={photo.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={publicUrlFor(photo.path)}
                alt={weed.common}
                className={`h-16 w-20 rounded-md border object-cover ${printing ? "border-primary ring-2 ring-primary/40" : "border-border"}`}
              />
              <button
                type="button"
                title={printing ? "This one prints" : "Print this one instead"}
                onClick={() => run(() => setPrintPhoto(weed.id, photo.id))}
                className={`absolute -left-1.5 -top-1.5 rounded-full p-0.5 text-white ${printing ? "bg-primary" : "bg-black/60"}`}
              >
                <Printer className="h-3 w-3" />
              </button>
              <button
                type="button"
                title="Drop this photo"
                onClick={() => run(() => removeWeedPhoto(photo.id))}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className={`flex h-16 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium ${
            weed.photos.length === 0
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "border border-dashed border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
          {uploading ? "Uploading" : weed.photos.length === 0 ? "Add the photo" : "Add more"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>

      {weed.photos.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-amber-700">
          No photo yet, so this weed prints as an empty square. The first one added becomes the one that prints; add as
          many as you like and the rest show on the phone when the code is scanned.
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          The one ringed with the printer mark goes on paper. The other {Math.max(weed.photos.length - 1, 0)} show when
          the code is scanned.
        </p>
      )}

      <div className="mt-2">
        <label className="text-[11px] font-medium text-muted-foreground" htmlFor={`prep-${weed.id}`}>
          Prep before treating
        </label>
        <div className="mt-1 flex items-start gap-2">
          <textarea
            id={`prep-${weed.id}`}
            value={prep}
            onChange={(e) => setPrep(e.target.value)}
            onBlur={savePrep}
            rows={2}
            placeholder="What has to happen before this one is treated."
            className="min-h-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          {saved && <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />}
        </div>
      </div>

      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
