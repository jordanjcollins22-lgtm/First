"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, KeyRound, Loader2, MapPin, Navigation, Package, Phone, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { subAttachPhoto, subFinish, subPhotoSlot, subStep } from "@/lib/actions/sub-crew-actions";
import { sayTime, subStage, type AreaState, type SubStage } from "@/lib/sub-crew";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { THUMBNAIL } from "@/lib/storage-image-url";
import { ZonePhotos } from "@/components/job/marked-photo";
import { AreaTodo } from "@/components/job/area-todo";
import { PriceSiteMap } from "@/components/proposal/price-site-map";
import type { SubCrewSheet } from "@/lib/data/sub-crew";
import { cn } from "@/lib/utils";

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/**
 * A subcontractor's crew sheet, from the link the office sent them. Kept to
 * what they press: pick up at the shop (only when they use our tools), On
 * my way, I've arrived, I have questions, and We're finished. The areas are
 * there to read, with the site map, the evaluation photos and what to do in
 * each; how they run their crew is theirs. We're finished asks for the after
 * photo of each area, one at a time, and the last one asks the account
 * manager to come and walk it.
 */
export function SubCrewSheetView({
  sheet,
  preview = false,
  stage: forcedStage,
  areaStates: forcedAreas,
  finishing: forcedFinishing = false,
}: {
  sheet: SubCrewSheet;
  /** For the owner's walk-through: taps record nothing. */
  preview?: boolean;
  /** For the walk-through's pages: show this stage. */
  stage?: SubStage;
  areaStates?: Record<string, AreaState>;
  /** For the walk-through's pages: We're finished has been pressed. */
  finishing?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [finishPressed, setFinishPressed] = useState(false);
  const stage = forcedStage ?? subStage(sheet.progress);
  const areas = forcedAreas ?? sheet.areaStates;
  const done = (id: string) => areas[id] === "done";
  // Once one after photo is in, they are finishing up, whatever the phone remembers.
  const finishing = forcedFinishing || finishPressed || sheet.zones.some((z) => done(z.id));
  const nextAfter = sheet.zones.find((z) => !done(z.id)) ?? null;
  const directions = sheet.lat != null && sheet.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${sheet.lat},${sheet.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(sheet.address)}`;
  const managerFirst = sheet.accountManager?.name.split(/\s+/)[0] ?? "the office";

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

  const questions = sheet.accountManager?.phone ? (
    <a
      href={preview ? "#" : `tel:${sheet.accountManager.phone}`}
      className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-background text-base font-medium"
    >
      <Phone className="h-4 w-4" /> I have questions · Call {managerFirst}
    </a>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{sheet.businessName} · Crew sheet</p>
        <h1 className="text-2xl font-bold leading-tight">{sheet.address}</h1>
        <p className="text-sm text-muted-foreground">
          {sheet.subcontractorName} · {sheet.startsOn === sheet.endsOn ? day(sheet.startsOn) : `${day(sheet.startsOn)} to ${day(sheet.endsOn)}`}
        </p>
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
          {questions}
        </section>
      )}

      {stage === "on_way" && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <h2 className="text-lg font-semibold">On the way</h2>
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending} onClick={() => step("arrived")}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <MapPin className="mr-2 h-5 w-5" />} I&apos;ve arrived
          </Button>
          <a href={preview ? "#" : directions} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center justify-center gap-1 text-sm font-medium text-primary">
            <Navigation className="h-4 w-4" /> Directions
          </a>
        </section>
      )}

      {stage === "on_site" && !finishing && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <h2 className="text-lg font-semibold">On site</h2>
          <p className="text-sm text-muted-foreground">Everything to do is below, area by area. When it&apos;s all done and cleaned up, tap We&apos;re finished.</p>
          <Button type="button" className="h-14 text-base font-semibold" onClick={() => setFinishPressed(true)}>
            <CheckCircle2 className="mr-2 h-5 w-5" /> We&apos;re finished
          </Button>
          {questions}
        </section>
      )}

      {stage === "on_site" && finishing && nextAfter && (
        <AfterPhoto
          key={nextAfter.id}
          token={sheet.token}
          zone={nextAfter}
          index={sheet.zones.indexOf(nextAfter)}
          of={sheet.zones.length}
          taken={sheet.zones.filter((z) => done(z.id)).length}
          last={sheet.zones.filter((z) => !done(z.id)).length === 1}
          preview={preview}
          onError={setError}
        />
      )}

      {stage === "on_site" && finishing && !nextAfter && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <p className="text-sm">Every after photo is in.</p>
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending} onClick={finish}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />} Ask {managerFirst} to walk it
          </Button>
        </section>
      )}

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
              <CheckCircle2 className="h-5 w-5" /> Finished. {managerFirst === "the office" ? "The account manager" : managerFirst} is coming to walk it. Keep the tools out until then.
            </p>
          )}
        </section>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Where each area is, so area 1 can be found. */}
      {sheet.siteMap && stage !== "pickup" && stage !== "finished" && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold">Where each area is</h2>
          <PriceSiteMap map={sheet.siteMap} />
        </section>
      )}

      {/* The whole scope, to read: photos and what to do in each area. */}
      {stage !== "finished" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">What you&apos;re doing</h2>
          {sheet.zones.map((zone, i) => (
            <AreaCard key={zone.id} zone={zone} index={i} done={stage === "on_site" && done(zone.id)} />
          ))}
        </section>
      )}
    </div>
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

/** An area to read: the evaluation photos, what to do, and the evaluator's note. */
function AreaCard({ zone, index, done }: { zone: SubCrewSheet["zones"][number]; index: number; done: boolean }) {
  return (
    <article className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-4", done ? "border-emerald-300" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <AreaTitle zone={zone} index={index} />
        {done && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">After photo in</span>}
      </div>
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

/**
 * Finishing up: the after photo of one area at a time, from the same spot
 * as the evaluation photo. The last one asks the account manager to come
 * and walk it.
 */
function AfterPhoto({
  token,
  zone,
  index,
  of,
  taken,
  last,
  preview,
  onError,
}: {
  token: string;
  zone: SubCrewSheet["zones"][number];
  index: number;
  of: number;
  taken: number;
  last: boolean;
  preview: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

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
      const saved = await subAttachPhoto(token, zone.id, slot.path);
      if (!saved.ok) return onError(saved.message);
      if (last) {
        const finished = await subFinish(token);
        if (!finished.ok) onError(finished.message);
      }
      router.refresh();
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-primary bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        After photos · {taken + 1} of {of}
      </p>
      <div className="flex items-start justify-between gap-2">
        <div>
          <AreaTitle zone={zone} index={index} />
          <p className="text-sm text-muted-foreground">{zone.location || zone.service}</p>
        </div>
        {zone.photos[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={canvasImageUrl(zone.photos[0].path, THUMBNAIL)} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        )}
      </div>
      <p className="text-sm text-muted-foreground">One photo of the finished area, from the same spot as the evaluation photo.</p>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void upload(e.target.files)} />
      <Button type="button" className="h-14 w-full text-base font-semibold" disabled={uploading} onClick={() => (preview ? undefined : input.current?.click())}>
        {uploading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Camera className="mr-2 h-5 w-5" />}
        {uploading ? "Uploading…" : "Take the after photo"}
      </Button>
      {last && <p className="text-center text-xs text-muted-foreground">The last one. It asks the account manager to come and walk it.</p>}
    </section>
  );
}
