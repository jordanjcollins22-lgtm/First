"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import mapboxgl from "mapbox-gl";
import { v4 as uuid } from "uuid";
import { Camera, Check, CheckCircle2, Loader2, Sprout, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createPreEvalPhotoUpload, submitPreEval } from "@/lib/actions/pre-eval-actions";
import type { ClientPreEval, PreEvalService } from "@/lib/data/pre-evals";
import { env } from "@/lib/env";
import {
  MAX_PHOTOS_PER_SPOT,
  MAX_SPOTS,
  PRE_EVAL_PHOTO_BUCKET,
  UNSURE_SERVICE,
  type PreEvalSpot,
} from "@/lib/pre-eval";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import "mapbox-gl/dist/mapbox-gl.css";

// `key` is local only, so a photo that finishes uploading lands on the right
// spot even if spots before it were removed meanwhile.
type LocalSpot = PreEvalSpot & { key: string };

const MAX_PHOTO_EDGE_PX = 1600;

/** Phone photos are 3-8 MB; shrink to a JPEG that's plenty for quoting. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_PHOTO_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function PreEvalForm({ preEval, services }: { preEval: ClientPreEval; services: PreEvalService[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"intro" | "map" | "sent">(preEval.spots.length > 0 ? "map" : "intro");
  const [spots, setSpots] = useState<LocalSpot[]>(() => preEval.spots.map((s) => ({ ...s, key: uuid() })));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Read inside the map click handler, which is bound once.
  const openKeyRef = useRef(openKey);
  useEffect(() => {
    openKeyRef.current = openKey;
  }, [openKey]);

  const openIndex = spots.findIndex((s) => s.key === openKey);
  const openSpot = openIndex >= 0 ? spots[openIndex] : null;

  useEffect(() => {
    if (step !== "map" || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = env.mapboxToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [preEval.lng, preEval.lat],
      zoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    map.on("click", (e) => {
      // Finish the open spot before starting another.
      if (openKeyRef.current) return;
      const key = uuid();
      setError(null);
      setSpots((prev) =>
        prev.length >= MAX_SPOTS
          ? prev
          : [...prev, { key, lng: e.lngLat.lng, lat: e.lngLat.lat, services: [], photos: [] }]
      );
      setOpenKey(key);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [step, preEval.lat, preEval.lng]);

  // Redraw the numbered pins whenever spots change. Tapping a pin opens it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = spots.map((spot, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `Spot ${i + 1}`);
      el.textContent = String(i + 1);
      el.className = cn(
        "flex size-9 items-center justify-center rounded-full border-[3px] border-white bg-primary text-base font-bold text-white shadow-lg",
        spot.key === openKey && "size-11 ring-4 ring-primary/50"
      );
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!openKeyRef.current) setOpenKey(spot.key);
      });
      return new mapboxgl.Marker({ element: el }).setLngLat([spot.lng, spot.lat]).addTo(map);
    });
  }, [spots, openKey, step]);

  // Keep the open spot visible above the sheet, which covers the bottom of the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const spot = spots.find((s) => s.key === openKey);
    const bottom = spot ? map.getContainer().clientHeight * 0.6 : 0;
    map.easeTo({ center: spot ? [spot.lng, spot.lat] : undefined, padding: { top: 0, left: 0, right: 0, bottom } });
    // Only when a spot opens or closes, not on every edit to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  function updateSpot(key: string, change: (spot: LocalSpot) => LocalSpot) {
    setSpots((prev) => prev.map((s) => (s.key === key ? change(s) : s)));
  }

  function toggleService(id: string) {
    if (!openKey) return;
    updateSpot(openKey, (s) => ({
      ...s,
      services: s.services.includes(id) ? s.services.filter((x) => x !== id) : [...s.services, id],
    }));
  }

  function removeOpenSpot() {
    setSpots((prev) => prev.filter((s) => s.key !== openKey));
    setOpenKey(null);
  }

  async function handlePhotos(files: FileList | null) {
    const key = openKey;
    if (!key || !files) return;
    setError(null);
    const room = MAX_PHOTOS_PER_SPOT - (openSpot?.photos.length ?? 0);
    const supabase = createClient();

    for (const file of Array.from(files).slice(0, room)) {
      setUploading((n) => n + 1);
      try {
        const upload = await createPreEvalPhotoUpload(preEval.id);
        if ("error" in upload) throw new Error(upload.error);
        const body = await shrinkPhoto(file);
        const { error: uploadError } = await supabase.storage
          .from(PRE_EVAL_PHOTO_BUCKET)
          .uploadToSignedUrl(upload.path, upload.token, body, { contentType: body.type || "image/jpeg" });
        if (uploadError) throw uploadError;
        setPreviews((prev) => ({ ...prev, [upload.path]: URL.createObjectURL(body) }));
        updateSpot(key, (s) => ({ ...s, photos: [...s.photos, upload.path] }));
      } catch (err) {
        console.error("[pre-eval] photo upload failed", err);
        setError("That photo didn't upload. Please try again.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function photoUrl(path: string) {
    return previews[path] ?? createClient().storage.from(PRE_EVAL_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  function handleSend() {
    setError(null);
    startTransition(async () => {
      const result = await submitPreEval(
        preEval.id,
        spots.map(({ lng, lat, services, photos }) => ({ lng, lat, services, photos }))
      );
      if (result.error) setError(result.error);
      else setStep("sent");
    });
  }

  if (step === "intro") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-accent text-primary">
          <Sprout className="size-10" />
        </span>
        <div>
          <h1 className="text-3xl font-bold">Head outside for this one</h1>
          <p className="mx-auto mt-3 max-w-sm text-lg text-muted-foreground">
            It&apos;s easiest standing in your yard, where you can look at your garden beds and see
            what needs to get done.
          </p>
        </div>
        <ol className="flex flex-col gap-2 text-left text-base">
          {["Tap a spot on the map", "Pick what you want done", "Snap a photo of it"].map((text, i) => (
            <li key={text} className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                {i + 1}
              </span>
              {text}
            </li>
          ))}
        </ol>
        <Button size="xl" className="w-full max-w-sm" onClick={() => setStep("map")}>
          I&apos;m ready
        </Button>
      </div>
    );
  }

  if (step === "sent") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <CheckCircle2 className="size-16 text-primary" />
        <h1 className="text-3xl font-bold">Got it, thank you!</h1>
        <p className="max-w-sm text-lg text-muted-foreground">
          We&apos;ll use the {spots.length === 1 ? "spot" : `${spots.length} spots`} you marked to put
          together your proposal today.
        </p>
        <Button variant="ghost" onClick={() => setStep("map")}>
          Change my answers
        </Button>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* mapbox-gl.css sets position: relative on the map element, so it can't be the absolute one. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-5 pb-10 pt-5 text-center text-white">
        <h1 className="text-2xl font-bold drop-shadow">Tap on the areas you&apos;d like worked on</h1>
      </div>

      {openSpot ? (
        <div className="absolute inset-x-0 bottom-0 flex max-h-[72%] flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.25)]">
          <p className="text-lg font-bold">
            Spot {openIndex + 1}: what do you want done here?
          </p>

          <div className="flex flex-wrap gap-2">
            {[...services, { id: UNSURE_SERVICE, name: "Not sure, take a look" }].map((service) => {
              const on = openSpot.services.includes(service.id);
              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => toggleService(service.id)}
                  className={cn(
                    "flex h-12 items-center gap-1.5 rounded-full border-2 px-4 text-base font-medium transition-colors",
                    on ? "border-primary bg-primary text-white" : "border-border bg-card"
                  )}
                >
                  {on && <Check className="size-4" />}
                  {service.name}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            {openSpot.photos.map((path) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={path} src={photoUrl(path)} alt="" className="size-20 rounded-lg object-cover" />
            ))}
            {uploading > 0 && (
              <span className="flex size-20 items-center justify-center rounded-lg bg-muted">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </span>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handlePhotos(e.target.files)}
          />
          {openSpot.photos.length < MAX_PHOTOS_PER_SPOT && (
            <Button
              type="button"
              size="lg"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="size-5" />
              {openSpot.photos.length === 0 ? "Take a photo" : "Add another photo"}
            </Button>
          )}

          {error && <p className="text-center text-sm font-medium text-destructive">{error}</p>}

          <div className="flex gap-3">
            <Button
              type="button"
              size="xl"
              variant="outline"
              className="px-5"
              disabled={uploading > 0}
              onClick={removeOpenSpot}
              aria-label="Remove this spot"
            >
              <Trash2 className="size-6" />
            </Button>
            <Button
              type="button"
              size="xl"
              className="flex-1"
              disabled={openSpot.services.length === 0 || uploading > 0}
              onClick={() => setOpenKey(null)}
            >
              {openSpot.services.length === 0 ? "Pick at least one" : "Done"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && (
            <p className="rounded-lg bg-card px-4 py-2 text-center text-sm font-medium text-destructive shadow">
              {error}
            </p>
          )}
          <Button
            type="button"
            size="xl"
            className="w-full shadow-lg"
            disabled={spots.length === 0 || isPending}
            onClick={handleSend}
          >
            {isPending ? (
              <Loader2 className="size-6 animate-spin" />
            ) : spots.length === 0 ? (
              "Tap the map to start"
            ) : (
              `Send ${spots.length} ${spots.length === 1 ? "area" : "areas"}`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
