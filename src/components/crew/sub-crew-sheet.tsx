"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, CheckCircle2, Circle, KeyRound, Loader2, MapPin, Navigation, Package, Phone, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { subAttachPhoto, subFinish, subPhotoSlot, subStep } from "@/lib/actions/sub-crew-actions";
import { canFinish, currentArea, sayTime, subAllPrepped, subStage, type AreaState, type SubStage } from "@/lib/sub-crew";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { THUMBNAIL } from "@/lib/storage-image-url";
import { ZonePhotos } from "@/components/job/marked-photo";
import { AreaTodo } from "@/components/job/area-todo";
import type { SubCrewSheet } from "@/lib/data/sub-crew";
import { cn } from "@/lib/utils";

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/**
 * A subcontractor's crew sheet, from the link the office sent them. One
 * button at a time: pick up at the shop (when they use our tools), On my
 * way, I've arrived; then the areas one at a time. Every area is prepped
 * first, its prep steps ticked and its prep photo taken; then the work
 * and clean up, area by area, each closed by its after photo; then We're
 * finished, which asks the account manager to come and walk it.
 */
export function SubCrewSheetView({
  sheet,
  preview = false,
  stage: forcedStage,
  areaStates: forcedAreas,
  tickedAll = false,
}: {
  sheet: SubCrewSheet;
  /** For the owner's walk-through: taps record nothing. */
  preview?: boolean;
  /** For the walk-through's pages: show this stage. */
  stage?: SubStage;
  areaStates?: Record<string, AreaState>;
  /** For the walk-through's pages: the current area's steps already ticked. */
  tickedAll?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stage = forcedStage ?? subStage(sheet.progress);
  const areas = forcedAreas ?? sheet.areaStates;
  const onSite = stage === "on_site" || stage === "finished";
  const finishable = canFinish(sheet.zones.map((z) => areas[z.id] ?? "todo"));
  const directions = sheet.lat != null && sheet.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${sheet.lat},${sheet.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(sheet.address)}`;
  const doneCount = sheet.zones.filter((z) => areas[z.id] === "done").length;
  const preppedCount = sheet.zones.filter((z) => (areas[z.id] ?? "todo") !== "todo").length;
  const prepping = !subAllPrepped(sheet.zones.map((z) => areas[z.id] ?? "todo"));
  const current = currentArea(sheet.zones, areas);

  function step(which: "picked_up" | "on_way" | "arrived") {
    setError(null);
    if (which === "on_way" && !preview) window.open(directions, "_blank", "noopener");
    if (preview) return;
    start(async () => {
      const result = await subStep(sheet.token, which);
      if (!result.ok) return setError(result.message);
      router.refresh();
    });
  }

  function finish() {
    setError(null);
    if (preview) return;
    start(async () => {
      const result = await subFinish(sheet.token);
      if (!result.ok) return setError(result.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{sheet.businessName} · Crew sheet</p>
        <h1 className="text-2xl font-bold leading-tight">{sheet.address}</h1>
        <p className="text-sm text-muted-foreground">
          {sheet.subcontractorName} · {sheet.startsOn === sheet.endsOn ? day(sheet.startsOn) : `${day(sheet.startsOn)} to ${day(sheet.endsOn)}`}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={preview ? "#" : directions} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium">
            <Navigation className="h-4 w-4" /> Directions
          </a>
          {sheet.accountManager?.phone && (
            <a href={preview ? "#" : `tel:${sheet.accountManager.phone}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium">
              <Phone className="h-4 w-4" /> Call {sheet.accountManager.name.split(/\s+/)[0]}
            </a>
          )}
        </div>
      </header>

      {/* The one thing to do now. */}
      {stage === "pickup" && sheet.shop && (
        <section className="flex flex-col gap-3 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <h2 className="text-lg font-semibold">First: pick up at the shop{sayTime(sheet.shop.arriveBy) ? ` by ${sayTime(sheet.shop.arriveBy)}` : ""}</h2>
          {sheet.shop.address && (
            <p className="flex items-start gap-1.5 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {sheet.shop.address}
            </p>
          )}
          {sheet.shop.accessCodes && (
            <p className="flex items-start gap-1.5 rounded-lg bg-background p-2.5 text-sm">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="font-semibold">Getting in: </span>
                {sheet.shop.accessCodes}
              </span>
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">Grab these kits</p>
            {sheet.kits.length === 0 && <p className="text-sm text-muted-foreground">No kits listed. Call the account manager.</p>}
            {sheet.kits.map((kit) => (
              <div key={kit.number} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-2.5">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Package className="h-4 w-4 text-primary" /> Kit {kit.number}
                  {kit.container && <span className="font-normal text-muted-foreground">· {kit.container}</span>}
                </p>
                {kit.code && <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm font-semibold">{kit.code}</span>}
              </div>
            ))}
          </div>
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending} onClick={() => step("picked_up")}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Wrench className="mr-2 h-5 w-5" />} Got the tools
          </Button>
        </section>
      )}

      {stage === "go" && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <h2 className="text-lg font-semibold">Head to the job</h2>
          <p className="text-sm text-muted-foreground">{sheet.usesOurTools ? "Tools in the truck." : "Bring your own tools."} Tap when you leave.</p>
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending} onClick={() => step("on_way")}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Navigation className="mr-2 h-5 w-5" />} On my way · Directions
          </Button>
        </section>
      )}

      {stage === "on_way" && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <h2 className="text-lg font-semibold">On the way</h2>
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending} onClick={() => step("arrived")}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <MapPin className="mr-2 h-5 w-5" />} I&apos;ve arrived
          </Button>
        </section>
      )}

      {/* Once every area is done, and after, what happens next leads the page. */}
      {stage === "finished" && (
        <section
          className={cn(
            "flex flex-col gap-2 rounded-2xl border p-4",
            sheet.walkthrough?.status === "rejected" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
          )}
        >
          {sheet.walkthrough?.status === "approved" ? (
            <p className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5" /> Walked and signed off. Thank you, you&apos;re done here.
            </p>
          ) : sheet.walkthrough?.status === "rejected" ? (
            <>
              <p className="font-semibold text-amber-900 dark:text-amber-200">Sent back. Fix these before you leave:</p>
              <p className="whitespace-pre-line text-sm">{sheet.walkthrough.notes}</p>
              <Button type="button" className="h-12 font-semibold" disabled={pending} onClick={finish}>
                Fixed it, walk it again
              </Button>
            </>
          ) : (
            <p className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5" /> Finished. The account manager is coming to walk it. Keep the tools out until then.
            </p>
          )}
        </section>
      )}

      {stage === "on_site" && finishable.ok && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending} onClick={finish}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />} We&apos;re finished
          </Button>
          <p className="text-center text-xs text-muted-foreground">The account manager comes to walk it. Keep the tools out until they have.</p>
        </section>
      )}

      {/* On site: every area prepped first, then the work, one area at a time. */}
      {stage === "on_site" && current && (
        <>
          <p className={cn("rounded-lg px-3 py-2 text-sm", prepping ? "bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" : "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100")}>
            {prepping
              ? "First, prep every area. The work starts once every area is prepped and has its prep photo."
              : "Every area is prepped. Now the work, one area at a time."}
          </p>
          <CurrentArea
            key={`${current.zone.id}-${current.kind}`}
            token={sheet.token}
            zone={current.zone}
            index={sheet.zones.indexOf(current.zone)}
            kind={current.kind}
            preview={preview}
            tickedAll={tickedAll}
            onError={setError}
          />
        </>
      )}

      {/* The areas: the whole scope before they arrive, where each one is once they have. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{onSite ? "All the areas" : "What you'll be doing"}</h2>
          {onSite && (
            <p className="text-xs text-muted-foreground">
              {prepping ? `${preppedCount} of ${sheet.zones.length} prepped` : `${doneCount} of ${sheet.zones.length} done`}
            </p>
          )}
        </div>
        {sheet.zones.map((zone, i) =>
          onSite ? (
            <AreaRow key={zone.id} zone={zone} index={i} state={areas[zone.id] ?? "todo"} current={current?.zone.id === zone.id} />
          ) : (
            <AreaCard key={zone.id} zone={zone} index={i} />
          )
        )}
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** An area's whole scope, before they arrive: the evaluation photos and what to do. */
function AreaCard({ zone, index }: { zone: SubCrewSheet["zones"][number]; index: number }) {
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
      <AreaTitle zone={zone} index={index} />
      <p className="text-sm text-muted-foreground">
        {zone.service}
        {zone.location ? ` · ${zone.location}` : ""}
        {zone.sizeLabel ? ` · ${zone.sizeLabel}` : ""}
      </p>
      <ZonePhotos photos={zone.photos} zoneName={zone.name} />
      <AreaTodo todo={zone.todo} />
      {zone.notes && <p className="rounded-lg border border-amber-400/50 bg-amber-50/60 p-2.5 text-sm dark:bg-amber-950/30">{zone.notes}</p>}
    </article>
  );
}

function AreaTitle({ zone, index }: { zone: SubCrewSheet["zones"][number]; index: number }) {
  return (
    <p className="font-semibold">
      <span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: zone.color }}>
        {index + 1}
      </span>
      {zone.name}
    </p>
  );
}

/** Once on site: where each area is, with its whole scope a tap away. */
function AreaRow({ zone, index, state, current }: { zone: SubCrewSheet["zones"][number]; index: number; state: AreaState; current: boolean }) {
  return (
    <details className={cn("rounded-xl border bg-card px-3 py-2.5", current ? "border-primary" : "border-border")}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <AreaTitle zone={zone} index={index} />
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            state === "done" ? "bg-emerald-100 text-emerald-800" : state === "prepped" ? "bg-amber-100 text-amber-900" : current ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}
        >
          {state === "done" ? "Done" : state === "prepped" ? "Prepped" : current ? "Now" : "To prep"}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <ZonePhotos photos={zone.photos} zoneName={zone.name} />
        <AreaTodo todo={zone.todo} />
      </div>
    </details>
  );
}

/**
 * The area they are on: the evaluation photo, the steps for now (the prep,
 * or the work and clean up), ticked as they go, then the one photo. The
 * ticks are on this phone only; the photo is the record.
 */
function CurrentArea({
  token,
  zone,
  index,
  kind,
  preview,
  tickedAll,
  onError,
}: {
  token: string;
  zone: SubCrewSheet["zones"][number];
  index: number;
  kind: "during" | "after";
  preview: boolean;
  tickedAll: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const groups: { title: string; lines: string[] }[] =
    kind === "during"
      ? [{ title: "Prep this area", lines: zone.phases.prep }]
      : [
          { title: "The work", lines: zone.phases.work },
          { title: "Clean up", lines: zone.phases.cleanup },
        ].filter((g) => g.lines.length > 0);
  const total = groups.reduce((n, g) => n + g.lines.length, 0);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(tickedAll ? groups.flatMap((g) => g.lines.map((_, i) => `${g.title}-${i}`)) : []));
  const ready = ticked.size >= total;

  function toggle(key: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    onError(null);
    setUploading(true);
    try {
      const slot = await subPhotoSlot(token);
      if (!slot.ok) return onError(slot.message);
      const sent = await createClient().storage.from("job-photos").uploadToSignedUrl(slot.path, slot.uploadToken, file, { contentType: file.type || "image/jpeg" });
      if (sent.error) return onError("Couldn't upload that photo. Check your signal and try again.");
      const saved = await subAttachPhoto(token, zone.id, kind, slot.path);
      if (!saved.ok) return onError(saved.message);
      router.refresh();
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border-2 border-primary bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <AreaTitle zone={zone} index={index} />
          <p className="text-sm text-muted-foreground">{zone.location || zone.service}</p>
        </div>
        {zone.photos[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={canvasImageUrl(zone.photos[0].path, THUMBNAIL)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        )}
      </div>

      {zone.notes && <p className="rounded-lg border border-amber-400/50 bg-amber-50/60 p-2.5 text-sm dark:bg-amber-950/30">{zone.notes}</p>}

      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="text-sm font-bold">{group.title}</p>
          {group.lines.map((line, i) => {
            const key = `${group.title}-${i}`;
            const done = ticked.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                className="flex min-h-11 items-start gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left text-sm"
              >
                {done ? <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                <span className={done ? "text-muted-foreground line-through" : ""}>{line}</span>
              </button>
            );
          })}
        </div>
      ))}
      {ready ? (
        <div className="sticky bottom-2 z-10 rounded-lg border border-dashed border-primary/60 bg-card p-2.5 shadow-lg">
          <p className="text-sm font-semibold">{kind === "during" ? "Prep done: take the prep photo" : "Clean up done: take the after photo"}</p>
          <p className="text-xs text-muted-foreground">
            {kind === "during" ? "One photo of the whole area, prepped. Then on to the next area." : "One photo of the finished area, from the same spot. This finishes it."}
          </p>
          <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void upload(e.target.files)} />
          <Button type="button" className="mt-2 h-12 w-full text-base font-semibold" disabled={uploading} onClick={() => (preview ? undefined : input.current?.click())}>
            {uploading ? <Loader2 className="mr-1.5 h-5 w-5 animate-spin" /> : <Camera className="mr-1.5 h-5 w-5" />}
            {uploading ? "Uploading…" : kind === "during" ? "Take the prep photo" : "Take the after photo"}
          </Button>
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">Tick each one as it&apos;s done. The photo comes next.</p>
      )}
    </article>
  );
}
