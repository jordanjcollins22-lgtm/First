"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPictureChoices, setPlanPictures, type PictureChoices, type PlanResult } from "@/lib/actions/social-plan-actions";
import { CENTRE, MAX_ZOOM, cropBox, type Crop } from "@/lib/social-crop";
import type { CardStyle } from "@/lib/social-plan";
import type { PlanPost } from "@/lib/data/social-plan";
import {
  ARRANGE_LABEL,
  BAR_LABEL,
  FIT_LABEL,
  TEXT_LABEL,
  photoSpaces,
  type Arrange,
  type BarSize,
  type Fit,
  type Layout,
  type TextSize,
} from "@/lib/social-layout";

const thumb = (id: string) => `/api/social/photo/${id}`;

type Slot = "before" | "after";

/**
 * Choose a post's photos and where each sits. Photos are grouped by the area
 * of the yard they were taken in, so a before and an after of the same spot
 * sit together; drag a photo in its frame to move it, and zoom to bring the
 * work in close.
 */
export function PictureEditor({ post, onDone }: { post: PlanPost; onDone: (r: PlanResult) => void }) {
  const [choices, setChoices] = useState<PictureChoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<CardStyle>(post.cardStyle ?? (post.beforeId ? "split" : post.afterId ? "photo" : "brand"));
  const [jobId, setJobId] = useState<string | null>(post.jobId);
  const [beforeId, setBeforeId] = useState<string | null>(post.beforeId);
  const [afterId, setAfterId] = useState<string | null>(post.afterId);
  const [beforeCrop, setBeforeCrop] = useState<Crop>(post.beforeCrop);
  const [afterCrop, setAfterCrop] = useState<Crop>(post.afterCrop);
  const [choosing, setChoosing] = useState<Slot>(post.beforeId ? "after" : "before");
  const [layout, setLayout] = useState<Layout>(post.layout);
  const spaces = photoSpaces(style === "split" ? "split" : "photo", layout);
  // The finished picture with this layout, drawn from the saved photos.
  const [preview, setPreview] = useState(post.imageUrl);
  useEffect(() => {
    const t = setTimeout(() => setPreview(`${post.imageUrl}&layout=${encodeURIComponent(JSON.stringify(layout))}`), 400);
    return () => clearTimeout(t);
  }, [layout, post.imageUrl]);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const r = await getPictureChoices(jobId);
      if ("error" in r) setError(r.error);
      else {
        setChoices(r);
        if (!jobId && r.jobId) setJobId(r.jobId);
      }
    });
    // Only when the job changes.
  }, [jobId]);

  const zoneOf = (id: string | null) => choices?.photos.find((p) => p.id === id)?.zone ?? null;
  const pairedZone = zoneOf(choosing === "after" ? beforeId : afterId);
  const zones = Array.from(new Set((choices?.photos ?? []).map((p) => p.zone ?? "No area")));
  // The area the other photo is from comes first: that is where its match is.
  zones.sort((a, b) => Number(b === pairedZone) - Number(a === pairedZone));

  function choose(id: string) {
    if (style === "photo" || choosing === "after") {
      setAfterId(id);
      setAfterCrop(CENTRE);
    } else {
      setBeforeId(id);
      setBeforeCrop(CENTRE);
      setChoosing("after");
    }
  }

  function swap() {
    setBeforeId(afterId);
    setAfterId(beforeId);
    setBeforeCrop(afterCrop);
    setAfterCrop(beforeCrop);
  }

  function save() {
    startSave(async () => {
      const r = await setPlanPictures(post.id, { jobId, cardStyle: style, beforeId, afterId, beforeCrop, afterCrop, layout });
      onDone(r);
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-background/60 p-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["split", "Before and after"],
            ["photo", "One photo"],
            ["brand", "No photo"],
          ] as [CardStyle, string][]
        ).map(([key, label]) => (
          <Button key={key} size="sm" variant={style === key ? "default" : "outline"} onClick={() => setStyle(key)}>
            {label}
          </Button>
        ))}
      </div>

      {style !== "brand" && (
        <div className="grid gap-3 rounded-md border p-2 sm:grid-cols-[1fr_180px]">
          <div className="flex flex-col gap-2">
            {style === "split" && (
              <Choice label="Layout" value={layout.arrange} options={ARRANGE_LABEL} onChange={(v: Arrange) => setLayout({ ...layout, arrange: v })} />
            )}
            <Choice label="Photos" value={layout.fit} options={FIT_LABEL} onChange={(v: Fit) => setLayout({ ...layout, fit: v })} />
            <Choice label="Headline" value={layout.text} options={TEXT_LABEL} onChange={(v: TextSize) => setLayout({ ...layout, text: v })} />
            <Choice label="Bottom bar" value={layout.bar} options={BAR_LABEL} onChange={(v: BarSize) => setLayout({ ...layout, bar: v })} />
            <p className="text-[11px] text-muted-foreground">
              Phone photos are tall: side by side, or showing the whole photo, keeps more of the work in. The preview uses the saved photos; save to see new ones.
            </p>
          </div>
          <a href={preview} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- drawn by the app's own picture route */}
            <img src={preview} alt="Preview of the finished picture" className="w-full rounded border" />
          </a>
        </div>
      )}

      {style !== "brand" && (
        <>
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div className="flex flex-col gap-2">
              {style === "split" ? (
                <>
                  <div className={layout.arrange === "side" ? "grid grid-cols-2 gap-1" : "flex flex-col gap-2"}>
                    <Framer label="Before" id={beforeId} space={spaces.before ?? spaces.after} fit={layout.fit} crop={beforeCrop} onCrop={setBeforeCrop} active={choosing === "before"} onPick={() => setChoosing("before")} />
                    <Framer label="After" id={afterId} space={spaces.after} fit={layout.fit} crop={afterCrop} onCrop={setAfterCrop} active={choosing === "after"} onPick={() => setChoosing("after")} />
                  </div>
                  <Button size="sm" variant="outline" onClick={swap} disabled={!beforeId || !afterId}>
                    <ArrowUpDown className="h-4 w-4" /> Swap before and after
                  </Button>
                </>
              ) : (
                <Framer label="Photo" id={afterId} space={spaces.after} fit={layout.fit} crop={afterCrop} onCrop={setAfterCrop} active onPick={() => setChoosing("after")} />
              )}
              <p className="text-[11px] text-muted-foreground">
                {layout.fit === "whole" ? "The whole photo is shown, so there is nothing to move." : "Drag a photo to move it. Use the slider to zoom."}
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={jobId ?? ""}
                onChange={(e) => setJobId(e.target.value || null)}
              >
                {(choices?.jobs ?? []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {style === "split" ? `Tap a photo to use it as the ${choosing}.` : "Tap a photo to use it."}
                {pairedZone && style === "split" ? ` ${pairedZone} is first: the ${choosing === "after" ? "before" : "after"} is from there.` : ""}
              </p>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1">
                {zones.map((zone) => (
                  <div key={zone}>
                    <p className="mb-1 text-xs font-semibold">{zone}</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {(choices?.photos ?? [])
                        .filter((p) => (p.zone ?? "No area") === zone)
                        .map((p) => {
                          const picked = p.id === beforeId ? "Before" : p.id === afterId ? (style === "split" ? "After" : "Picked") : null;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => choose(p.id)}
                              className={`relative overflow-hidden rounded-md border-2 ${picked ? "border-primary" : "border-transparent"}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- the app's own small copy of a private photo */}
                              <img src={thumb(p.id)} alt={`${p.kind} photo, ${zone}`} loading="lazy" className="aspect-square w-full object-cover" />
                              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold uppercase text-white">{p.kind}</span>
                              {picked && <span className="absolute bottom-1 right-1 rounded bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{picked}</span>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save pictures
        </Button>
        <Button variant="ghost" onClick={() => onDone({ ok: true, message: "" })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One row of layout choices. */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-20 text-xs font-semibold text-muted-foreground">{label}</span>
      {(Object.keys(options) as T[]).map((key) => (
        <Button key={key} type="button" size="sm" variant={value === key ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => onChange(key)}>
          {options[key]}
        </Button>
      ))}
    </div>
  );
}

/**
 * One photo in its frame, shaped like its space in the finished picture and
 * cut by the same rule the picture is drawn with. Drag to move; slider to zoom.
 * Shown whole, it sits inside the frame on the dark background instead.
 */
function Framer({
  label,
  id,
  space,
  fit,
  crop,
  onCrop,
  active,
  onPick,
}: {
  label: string;
  id: string | null;
  space: { width: number; height: number };
  fit: Fit;
  crop: Crop;
  onCrop: (c: Crop) => void;
  active: boolean;
  onPick: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frameW, setFrameW] = useState(200);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameH = Math.round((frameW * space.height) / space.width);
  const whole = fit === "whole";
  const box = natural && !whole ? cropBox(natural.w, natural.h, frameW, frameH, crop) : null;

  function onPointerDown(e: React.PointerEvent) {
    onPick();
    if (!box) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, crop };
  }
  function onPointerMove(e: React.PointerEvent) {
    const start = drag.current;
    if (!start || !natural) return;
    const b = cropBox(natural.w, natural.h, frameW, frameH, start.crop);
    const spareX = b.width - frameW;
    const spareY = b.height - frameH;
    const x = spareX > 0 ? start.crop.x - ((e.clientX - start.x) / spareX) * 100 : start.crop.x;
    const y = spareY > 0 ? start.crop.y - ((e.clientY - start.y) / spareY) * 100 : start.crop.y;
    onCrop({ ...start.crop, x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) });
  }
  function onPointerUp() {
    drag.current = null;
  }

  return (
    <div className={`rounded-md border-2 p-1 ${active ? "border-primary" : "border-transparent"}`}>
      <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
      <div
        ref={frame}
        className="relative w-full touch-none overflow-hidden rounded bg-muted"
        style={{ height: frameH, cursor: id ? "grab" : "pointer" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {id ? (
          // eslint-disable-next-line @next/next/no-img-element -- positioned by hand to match the drawn picture
          <img
            key={id}
            src={thumb(id)}
            alt={label}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={
              whole
                ? { width: "100%", height: "100%", objectFit: "contain", background: "#14261a" }
                : box
                  ? { position: "absolute", width: box.width, height: box.height, left: -box.left, top: -box.top, maxWidth: "none" }
                  : { opacity: 0 }
            }
          />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-muted-foreground">Tap a photo</span>
        )}
      </div>
      {id && !whole && (
        <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          Zoom
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.05}
            value={crop.zoom}
            onChange={(e) => onCrop({ ...crop, zoom: Number(e.target.value) })}
            className="flex-1"
          />
        </label>
      )}
    </div>
  );
}
