"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import mapboxgl from "mapbox-gl";
import { CheckCircle2, Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { submitPreEval } from "@/lib/actions/pre-eval-actions";
import type { ClientPreEval } from "@/lib/data/pre-evals";
import { env } from "@/lib/env";
import { MAX_TAPS, type PreEvalTap } from "@/lib/pre-eval";

import "mapbox-gl/dist/mapbox-gl.css";

export function PreEvalForm({ preEval }: { preEval: ClientPreEval }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const [taps, setTaps] = useState<PreEvalTap[]>(preEval.taps);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
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
      setError(null);
      setTaps((prev) => (prev.length >= MAX_TAPS ? prev : [...prev, [e.lngLat.lng, e.lngLat.lat]]));
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [preEval.lat, preEval.lng]);

  // Redraw the numbered pins whenever the taps change. Tapping a pin removes it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = taps.map((tap, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `Remove spot ${i + 1}`);
      el.textContent = String(i + 1);
      el.className =
        "flex size-9 items-center justify-center rounded-full border-[3px] border-white bg-primary text-base font-bold text-white shadow-lg";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setTaps((prev) => prev.filter((_, j) => j !== i));
      });
      return new mapboxgl.Marker({ element: el }).setLngLat(tap).addTo(map);
    });
  }, [taps]);

  function handleSend() {
    setError(null);
    startTransition(async () => {
      const result = await submitPreEval(preEval.id, taps);
      if (result.error) setError(result.error);
      else setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <CheckCircle2 className="size-16 text-primary" />
        <h1 className="text-3xl font-bold">Got it, thank you!</h1>
        <p className="max-w-sm text-lg text-muted-foreground">
          We&apos;ll look over the {taps.length === 1 ? "spot" : `${taps.length} spots`} you marked
          before your evaluation.
        </p>
        <Button variant="ghost" onClick={() => setSent(false)}>
          Change my answers
        </Button>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-5 pb-10 pt-5 text-center text-white">
        <h1 className="text-2xl font-bold drop-shadow">Tap on the areas you&apos;d like worked on</h1>
        <p className="mt-1 text-sm text-white/85 drop-shadow">Tap a pin again to remove it.</p>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && (
          <p className="rounded-lg bg-card px-4 py-2 text-center text-sm font-medium text-destructive shadow">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button
            type="button"
            size="xl"
            variant="outline"
            className="px-5 shadow-lg"
            disabled={taps.length === 0 || isPending}
            onClick={() => setTaps((prev) => prev.slice(0, -1))}
            aria-label="Undo last tap"
          >
            <Undo2 className="size-6" />
          </Button>
          <Button
            type="button"
            size="xl"
            className="flex-1 shadow-lg"
            disabled={taps.length === 0 || isPending}
            onClick={handleSend}
          >
            {isPending ? (
              <Loader2 className="size-6 animate-spin" />
            ) : taps.length === 0 ? (
              "Tap the map to start"
            ) : (
              `Send ${taps.length} ${taps.length === 1 ? "area" : "areas"}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
