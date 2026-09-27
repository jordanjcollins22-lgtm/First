"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, KeyRound, Loader2, MapPin, Navigation, Package, Phone, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { subAttachPhoto, subFinish, subPhotoSlot, subStep } from "@/lib/actions/sub-crew-actions";
import { canFinish, sayTime, subStage, type AreaState, type SubStage } from "@/lib/sub-crew";
import { ZonePhotos } from "@/components/job/marked-photo";
import { AreaTodo } from "@/components/job/area-todo";
import type { SubCrewSheet } from "@/lib/data/sub-crew";
import { cn } from "@/lib/utils";

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/**
 * A subcontractor's crew sheet, from the link the office sent them. One
 * button at a time: pick up at the shop (when they use our tools), On my
 * way, I've arrived; then each area, with what to do, a during photo when
 * the prep is done and an after photo when it is cleaned up; then We're
 * finished, which asks the account manager to come and walk it.
 */
export function SubCrewSheetView({
  sheet,
  preview = false,
  stage: forcedStage,
  areaStates: forcedAreas,
}: {
  sheet: SubCrewSheet;
  /** For the owner's walk-through: taps record nothing. */
  preview?: boolean;
  /** For the walk-through's pages: show this stage. */
  stage?: SubStage;
  areaStates?: Record<string, AreaState>;
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
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending || !finishable.ok} onClick={finish}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />} We&apos;re finished
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            The account manager comes to walk it. Keep the tools out until they have.
          </p>
        </section>
      )}

      {/* The areas: what to do in each, then its photos once on site. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{onSite ? "The areas" : "What you'll be doing"}</h2>
          {onSite && (
            <p className="text-xs text-muted-foreground">
              {doneCount} of {sheet.zones.length} done
            </p>
          )}
        </div>
        {sheet.zones.map((zone, i) => (
          <AreaCard key={zone.id} token={sheet.token} zone={zone} index={i} state={areas[zone.id] ?? "todo"} onSite={onSite && stage !== "finished"} preview={preview} onError={setError} />
        ))}
      </section>

      {stage === "on_site" && !finishable.ok && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending || !finishable.ok} onClick={finish}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />} We&apos;re finished
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {finishable.ok ? "" : finishable.reason}
          </p>
        </section>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function AreaCard({
  token,
  zone,
  index,
  state,
  onSite,
  preview,
  onError,
}: {
  token: string;
  zone: SubCrewSheet["zones"][number];
  index: number;
  state: AreaState;
  onSite: boolean;
  preview: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const kind: "during" | "after" = state === "todo" ? "during" : "after";

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
    <article className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-4", state === "done" ? "border-emerald-300" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">
          <span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: zone.color }}>
            {index + 1}
          </span>
          {zone.name}
        </p>
        {onSite && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              state === "done" ? "bg-emerald-100 text-emerald-800" : state === "prepped" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground"
            )}
          >
            {state === "done" ? "Done" : state === "prepped" ? "Prepped" : "To do"}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {zone.service}
        {zone.location ? ` · ${zone.location}` : ""}
        {zone.sizeLabel ? ` · ${zone.sizeLabel}` : ""}
      </p>
      <ZonePhotos photos={zone.photos} zoneName={zone.name} />
      <AreaTodo todo={zone.todo} />
      {zone.notes && <p className="rounded-lg border border-amber-400/50 bg-amber-50/60 p-2.5 text-sm dark:bg-amber-950/30">{zone.notes}</p>}

      {onSite && state !== "done" && (
        <div className="rounded-lg border border-dashed border-primary/60 bg-primary/5 p-2.5">
          <p className="text-sm font-semibold">{kind === "during" ? "Prep done: take the during photo" : "Clean up done: take the after photo"}</p>
          <p className="text-xs text-muted-foreground">
            {kind === "during" ? "One photo of the area, prepped." : "One photo of the finished area. This finishes it."}
          </p>
          <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void upload(e.target.files)} />
          <Button type="button" className="mt-2 w-full" disabled={uploading} onClick={() => (preview ? undefined : input.current?.click())}>
            {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            {uploading ? "Uploading…" : kind === "during" ? "Take the during photo" : "Take the after photo"}
          </Button>
        </div>
      )}
    </article>
  );
}
