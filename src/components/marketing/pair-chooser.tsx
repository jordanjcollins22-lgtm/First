"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPictureChoices, type PictureChoices } from "@/lib/actions/social-plan-actions";

export const photoThumb = (id: string, size: "small" | "large" = "small") => `/api/social/photo/${id}${size === "large" ? "?size=large" : ""}`;

/**
 * Pick the before and the after for a post from one job's photos, grouped
 * by the area of the yard. Tap a photo for the before, then one for the
 * after; the area the before came from is listed first.
 */
export function PairChooser({
  jobId,
  beforeId: initialBefore,
  afterId: initialAfter,
  onUse,
  onCancel,
}: {
  jobId: string;
  beforeId: string;
  afterId: string;
  onUse: (pair: { beforeId: string; afterId: string; zone: string | null }) => void;
  onCancel: () => void;
}) {
  const [choices, setChoices] = useState<PictureChoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState(initialBefore);
  const [afterId, setAfterId] = useState(initialAfter);
  const [choosing, setChoosing] = useState<"before" | "after">("before");
  const [loading, start] = useTransition();

  useEffect(() => {
    start(async () => {
      const r = await getPictureChoices(jobId);
      if ("error" in r) setError(r.error);
      else setChoices(r);
    });
  }, [jobId]);

  const zoneOf = (id: string) => choices?.photos.find((p) => p.id === id)?.zone ?? null;
  const pairedZone = zoneOf(choosing === "after" ? beforeId : afterId);
  const zones = Array.from(new Set((choices?.photos ?? []).map((p) => p.zone ?? "No area")));
  zones.sort((a, b) => Number(b === pairedZone) - Number(a === pairedZone));

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/70 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={choosing === "before" ? "default" : "outline"} onClick={() => setChoosing("before")}>
          Choosing the before
        </Button>
        <Button size="sm" variant={choosing === "after" ? "default" : "outline"} onClick={() => setChoosing("after")}>
          Choosing the after
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setBeforeId(afterId);
            setAfterId(beforeId);
          }}
        >
          <ArrowUpDown className="h-4 w-4" /> Swap
        </Button>
      </div>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto pr-1">
        {zones.map((zone) => (
          <div key={zone}>
            <p className="mb-1 text-xs font-semibold">{zone}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {(choices?.photos ?? [])
                .filter((p) => (p.zone ?? "No area") === zone)
                .map((p) => {
                  const picked = p.id === beforeId ? "Before" : p.id === afterId ? "After" : null;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        if (choosing === "before") {
                          setBeforeId(p.id);
                          setChoosing("after");
                        } else setAfterId(p.id);
                      }}
                      className={`relative overflow-hidden rounded-md border-2 ${picked ? "border-primary" : "border-transparent"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- the app's own small copy of a private photo */}
                      <img src={photoThumb(p.id)} alt={`${p.kind} photo, ${zone}`} loading="lazy" className="aspect-square w-full object-cover" />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold uppercase text-white">{p.kind}</span>
                      {picked && <span className="absolute bottom-1 right-1 rounded bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{picked}</span>}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!beforeId || !afterId || beforeId === afterId} onClick={() => onUse({ beforeId, afterId, zone: zoneOf(afterId) ?? zoneOf(beforeId) })}>
          Use these
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
