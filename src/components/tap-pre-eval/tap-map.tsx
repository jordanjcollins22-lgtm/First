"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { Camera, Check, Loader2, Sprout, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { removeIntakePhoto } from "@/lib/actions/evaluation-intake-actions";
import { submitTapPreEval } from "@/lib/actions/tap-estimate-actions";
import { sendOrKeep } from "@/lib/offline/outbox-send";
import { publicEnv } from "@/lib/public-env";
import { isHeic, shrinkImage } from "@/lib/shrink-image";
import { areaForPoint, MAX_PHOTOS_PER_SPOT, MAX_SPOTS, regionsFor, TAP_CHOICES, type TapSpot } from "@/lib/tap-estimate";
import type { LngLat, LotData } from "@/lib/lot-map";
import { cn } from "@/lib/utils";

import "mapbox-gl/dist/mapbox-gl.css";

// `key` is local only, so a photo that finishes uploading lands on the right
// spot even if spots before it were removed meanwhile.
type LocalSpot = TapSpot & { key: string };

export interface TapMapProps {
  token: string;
  home: LngLat;
  lot: LotData | null;
  /** Spots already sent, to change. */
  initialSpots: TapSpot[];
  photoUrls: Record<string, string>;
  /** Their first name, to greet them straight from the details page. */
  firstName: string | null;
  estimateHref: string;
}

export function TapMap({ token, home, lot, initialSpots, photoUrls, firstName, estimateHref }: TapMapProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const regions = useMemo(() => regionsFor(lot), [lot]);

  const [step, setStep] = useState<"intro" | "map">(initialSpots.length > 0 ? "map" : "intro");
  const [spots, setSpots] = useState<LocalSpot[]>(() => initialSpots.map((s) => ({ ...s, key: crypto.randomUUID() })));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>(photoUrls);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Read inside the map's click handler, which is bound once.
  const openKeyRef = useRef(openKey);
  useEffect(() => {
    openKeyRef.current = openKey;
  }, [openKey]);

  const openIndex = spots.findIndex((s) => s.key === openKey);
  const openSpot = openIndex >= 0 ? spots[openIndex] : null;

  useEffect(() => {
    if (step !== "map" || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = publicEnv.mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: home,
      zoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    // Their property line from the county, so "the back bed" has a frame.
    if (lot?.ring?.length) {
      map.on("load", () => {
        map.addSource("lot", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [lot.ring] } } });
        map.addLayer({ id: "lot-line", type: "line", source: "lot", paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 1.5], "line-opacity": 0.85 } });
      });
    }

    map.on("click", (e) => {
      // Finish the open spot before starting another.
      if (openKeyRef.current) return;
      const key = crypto.randomUUID();
      setError(null);
      setSpots((prev) => (prev.length >= MAX_SPOTS ? prev : [...prev, { key, lng: e.lngLat.lng, lat: e.lngLat.lat, choices: [], photos: [] }]));
      setOpenKey(key);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [step, home, lot]);

  // The numbered pins, redrawn whenever the spots change. Tapping one opens it.
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

  // Keep the open spot in view above the sheet, which covers the bottom of the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const spot = spots.find((s) => s.key === openKey);
    const bottom = spot ? map.getContainer().clientHeight * 0.6 : 0;
    map.easeTo({ center: spot ? [spot.lng, spot.lat] : undefined, padding: { top: 0, left: 0, right: 0, bottom } });
    // Only when a spot opens or closes, not on every change to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  function updateSpot(key: string, change: (spot: LocalSpot) => LocalSpot) {
    setSpots((prev) => prev.map((s) => (s.key === key ? change(s) : s)));
  }

  function toggleChoice(value: string) {
    if (!openKey) return;
    updateSpot(openKey, (s) => ({
      ...s,
      choices: s.choices.includes(value) ? s.choices.filter((c) => c !== value) : [...s.choices, value],
    }));
  }

  function removeOpenSpot() {
    const spot = openSpot;
    setSpots((prev) => prev.filter((s) => s.key !== openKey));
    setOpenKey(null);
    // Their photos come off the form too, so the evaluator isn't left with
    // pictures of a spot nobody asked about.
    for (const path of spot?.photos ?? []) removeIntakePhoto({ token, path }).catch(() => {});
  }

  async function addPhotos(files: FileList | null) {
    const spot = openSpot;
    if (!spot || !files) return;
    setError(null);
    // The form keeps photos by part of the yard; this spot's part, from the lot.
    const area = areaForPoint([spot.lng, spot.lat], regions) ?? "whole";
    for (const file of Array.from(files).slice(0, MAX_PHOTOS_PER_SPOT - spot.photos.length)) {
      setUploading((n) => n + 1);
      try {
        const small = await shrinkImage(file, 1600, 0.8).catch(() => file);
        if (isHeic(small)) {
          setError("This phone saved that photo in a format we can't open. Try taking it again with the camera.");
          break;
        }
        const type = small.type || (/\.png$/i.test(small.name) ? "image/png" : /\.webp$/i.test(small.name) ? "image/webp" : "image/jpeg");
        const sent = await sendOrKeep({ kind: "intake-photo", scope: `intake:${token}`, label: "Photo of a spot", blob: small, type, args: { token, area } });
        if (sent.status === "refused") {
          setError(sent.message);
          break;
        }
        if (sent.status === "kept") {
          setError("No signal right now. That photo will send by itself once you're back online.");
          continue;
        }
        const path = String(sent.result.path);
        setUrls((prev) => ({ ...prev, [path]: String(sent.result.url) }));
        updateSpot(spot.key, (s) => ({ ...s, photos: [...s.photos, path] }));
      } catch {
        setError("That photo didn't upload. Check your signal and try again.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await submitTapPreEval({
        token,
        spots: spots.map(({ lng, lat, choices, photos }) => ({ lng, lat, choices, photos })),
      });
      if (!result.ok) setError(result.error);
      else router.push(estimateHref);
    });
  }

  if (step === "intro") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sprout className="size-10" />
        </span>
        <div>
          <h1 className="text-3xl font-bold">{firstName ? `Thanks, ${firstName}! Now show us what you'd like done` : "Show us what you'd like done"}</h1>
          <p className="mx-auto mt-3 max-w-sm text-lg text-muted-foreground">
            It&apos;s easiest outside, where you can look at your garden beds and see what needs to get done. You&apos;ll get
            your estimate as soon as you&apos;re finished.
          </p>
        </div>
        <ol className="flex flex-col gap-2 text-left text-base">
          {["Tap a spot on the map", "Pick what you want done", "Snap a photo of it"].map((text, i) => (
            <li key={text} className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
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

  return (
    <div className="relative h-dvh overflow-hidden">
      {/* mapbox-gl.css sets position: relative on the map element, so it can't be the absolute one. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-5 pb-10 pt-5 text-center text-white">
        <h1 className="text-2xl font-bold drop-shadow">Tap where you want work done</h1>
      </div>

      {openSpot ? (
        <div className="absolute inset-x-0 bottom-0 flex max-h-[72%] flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.25)]">
          <p className="text-lg font-bold">Spot {openIndex + 1}: what do you want done here?</p>

          <div className="flex flex-wrap gap-2">
            {TAP_CHOICES.map((choice) => {
              const on = openSpot.choices.includes(choice.value);
              return (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => toggleChoice(choice.value)}
                  className={cn(
                    "flex h-12 items-center gap-1.5 rounded-full border-2 px-4 text-base font-medium transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                  )}
                >
                  {on && <Check className="size-4" />}
                  {choice.label}
                </button>
              );
            })}
          </div>

          {(openSpot.photos.length > 0 || uploading > 0) && (
            <div className="flex flex-wrap gap-2">
              {openSpot.photos.map((path) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={path} src={urls[path]} alt="" className="size-20 rounded-lg bg-muted object-cover" />
              ))}
              {uploading > 0 && (
                <span className="flex size-20 items-center justify-center rounded-lg bg-muted">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </span>
              )}
            </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
          {openSpot.photos.length < MAX_PHOTOS_PER_SPOT && (
            <Button type="button" size="lg" variant="secondary" disabled={uploading > 0} onClick={() => fileInputRef.current?.click()}>
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
              disabled={openSpot.choices.length === 0 || uploading > 0}
              onClick={() => setOpenKey(null)}
            >
              {openSpot.choices.length === 0 ? "Pick at least one" : "Done"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && <p className="rounded-lg bg-card px-4 py-2 text-center text-sm font-medium text-destructive shadow">{error}</p>}
          <Button type="button" size="xl" className="w-full shadow-lg" disabled={spots.length === 0 || isPending} onClick={send}>
            {isPending ? (
              <>
                <Loader2 className="size-6 animate-spin" /> Working out your estimate
              </>
            ) : spots.length === 0 ? (
              "Tap the map to start"
            ) : (
              `Done, see my estimate`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
