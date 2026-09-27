"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronDown, Circle, Loader2, Lock, Phone, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ZonePhotos } from "@/components/job/marked-photo";
import { AreaTodo } from "@/components/job/area-todo";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { THUMBNAIL } from "@/lib/storage-image-url";
import { createClient } from "@/lib/supabase/client";
import { attachJobPhoto } from "@/lib/actions/job-photo-actions";
import { areaPhotoTaken, leaveArea, startArea, tickAreaStep } from "@/lib/actions/area-work-actions";
import { canTick, type AreaState, type Phase } from "@/lib/area-work";
import type { AreaBoardData } from "@/lib/data/area-board";
import type { WorkOrderZone } from "@/lib/work-order";

/**
 * The job on site, area by area, one thing to press at a time.
 *
 * First every area is prepped: pick an area, read the whole scope with the
 * evaluation photos, Start prep here, tick each prep step as it is done,
 * then the prep photo. That frees the area and the next one is up. Only
 * when every area has its prep photo does the install open, and then the
 * same again: Start the install, the install, the clean up, the after photo.
 *
 * Inside an area only its current steps show, with its photo button once
 * they are ticked. The whole scope is a tap away but out of the way.
 */
export function AreaBoard({
  jobId,
  zones,
  board,
  accountManager,
  map,
  actions,
}: {
  jobId: string;
  zones: WorkOrderZone[];
  board: AreaBoardData;
  accountManager: { name: string; phone: string | null } | null;
  /** Where each area is, when the page doesn't already show the site map above. */
  map?: React.ReactNode;
  /** For a demo: every button runs these instead, and nothing is saved or uploaded. */
  actions?: AreaActions;
}) {
  const act: AreaActions = actions ?? {
    start: (zoneId) => startArea(jobId, zoneId),
    leave: () => leaveArea(jobId),
    tick: (zoneId, key, done) => tickAreaStep(jobId, zoneId, key, done),
    photo: null,
  };
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // undefined: follow the suggestion (the next area to do). A tap overrides it.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  const stateOf = new Map(board.states.map((s) => [s.zoneId, s]));
  const numberOf = new Map(zones.map((z, i) => [z.id, i + 1]));
  const stage: "prep" | "work" = board.allPrepped ? "work" : "prep";
  const prepped = board.states.filter((s) => s.prepped).length;
  const done = board.states.filter((s) => s.status === "done").length;

  const toDo = (s: AreaState | undefined) => Boolean(s) && s!.status !== "waiting" && (stage === "prep" ? !s!.prepped : s!.status !== "done");
  const suggested = zones.find((z) => toDo(stateOf.get(z.id)))?.id ?? null;
  const open = picked === undefined ? suggested : picked;

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "That didn't work. Try again.");
      setPicked(undefined);
      if (!actions) router.refresh();
    });
  }

  if (zones.length === 0) return null;

  const myZone = board.myZoneId ? zones.find((z) => z.id === board.myZoneId) : undefined;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold">The areas</h2>
        <p className="text-xs text-muted-foreground">
          {stage === "prep" ? `${prepped} of ${zones.length} prepped` : `${done} of ${zones.length} done`}
        </p>
      </div>

      <p className={`rounded-lg px-3 py-2 text-sm ${stage === "prep" ? "bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" : "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100"}`}>
        {stage === "prep"
          ? "First, prep every area. The install starts once every area is prepped and has its prep photo."
          : "Every area is prepped. Now the install, one area at a time."}
      </p>

      {map}

      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {myZone ? (
        <>
          <InArea
            jobId={jobId}
            zone={myZone}
            number={numberOf.get(myZone.id)!}
            state={stateOf.get(myZone.id)!}
            everyAreaPrepped={board.allPrepped}
            steps={board.steps[myZone.id] ?? []}
            tips={board.tips[myZone.id] ?? []}
            tools={board.tools[myZone.id] ?? []}
            meId={board.meId}
            pending={pending}
            onTick={(key, value) => run(() => act.tick(myZone.id, key, value))}
            onLeave={() => run(() => act.leave())}
            demoPhoto={act.photo ? (kind) => run(() => act.photo!(myZone.id, kind)) : null}
            onPhoto={() => {
              setPicked(undefined);
              router.refresh();
            }}
            onError={setError}
          />
          {zones.length > 1 && (
            <p className="text-center text-xs text-muted-foreground">
              {stage === "prep" ? `${zones.length - prepped - 1} more to prep after this one.` : `${zones.length - done - 1} more after this one.`}
            </p>
          )}
        </>
      ) : (
        <>
          {done === 0 && prepped === 0 && accountManager && (
            <p className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              Questions before you start? Ask {accountManager.name}.
              {accountManager.phone && (
                <a href={`tel:${accountManager.phone}`} className="flex items-center gap-1 font-medium text-primary">
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
              )}
            </p>
          )}
          <ol className="flex flex-col gap-2">
            {zones.map((zone) => {
              const state = stateOf.get(zone.id)!;
              const expanded = open === zone.id;
              return (
                <li
                  key={zone.id}
                  className={`rounded-xl border bg-card/80 backdrop-blur-md ${expanded ? "border-2 border-primary" : toDo(state) ? "border-white/60" : "border-border opacity-80"}`}
                >
                  <button type="button" className="flex w-full items-start gap-2 p-3 text-left" onClick={() => setPicked(expanded ? null : zone.id)}>
                    <AreaBadge zone={zone} number={numberOf.get(zone.id)!} state={state} stage={stage} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{zone.name}</span>
                      <span className="block text-sm text-primary">{zone.service}</span>
                      <StatusLine state={state} stage={stage} meId={board.meId} />
                    </span>
                    {/* The area as the evaluator saw it, so it can be found before it is opened. */}
                    {!expanded && zone.photos[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={canvasImageUrl(zone.photos[0].path, THUMBNAIL)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" />
                    )}
                    <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>

                  {expanded && (
                    <div className="flex flex-col gap-3 border-t border-border px-3 pb-3 pt-3">
                      <Scope zone={zone} tools={board.tools[zone.id] ?? []} state={state} />
                      {/* Read the scope, then start: the button stays in reach at the bottom of the screen. */}
                      <div className="sticky bottom-2 z-10">
                        <StartButton state={state} stage={stage} pending={pending} onStart={() => run(() => act.start(zone.id))} />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function AreaBadge({ zone, number, state, stage }: { zone: WorkOrderZone; number: number; state: AreaState; stage: "prep" | "work" }) {
  const tick = state.status === "done" || (stage === "prep" && state.prepped);
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: zone.color }}>
      {tick ? <Check className="h-4 w-4" /> : number}
    </span>
  );
}

function StatusLine({ state, stage, meId }: { state: AreaState; stage: "prep" | "work"; meId: string | null }) {
  if (state.status === "done") return <span className="mt-0.5 block text-xs text-emerald-700">Done</span>;
  if (stage === "prep" && state.prepped) return <span className="mt-0.5 block text-xs text-emerald-700">Prepped, prep photo in</span>;
  if (state.status === "waiting") {
    return (
      <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
        <Lock className="h-3 w-3" /> {state.waitingReason}
      </span>
    );
  }
  if (state.status === "working") {
    return (
      <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        <Users className="h-3 w-3" />
        {state.people.map((p) => (p.profileId === meId ? "You" : p.name)).join(", ")}
        {" · "}
        {stage === "prep" ? "Prepping" : "Installing"}
        {state.kits.length > 0 && ` · kit ${state.kits.join(", ")}`}
      </span>
    );
  }
  return (
    <span className="mt-0.5 block text-xs text-muted-foreground">
      {stage === "prep" ? "To prep" : "Ready to install"}
      {state.wouldTake.length > 0 ? ` · takes kit ${state.wouldTake.join(", ")}` : ""}
    </span>
  );
}

/** The whole scope of an area: the evaluation photos, what to do, the note, the tools. */
function Scope({ zone, tools, state }: { zone: WorkOrderZone; tools: string[]; state: AreaState }) {
  return (
    <>
      {(zone.location || zone.sizeLabel) && <p className="text-xs text-muted-foreground">{[zone.location, zone.sizeLabel].filter(Boolean).join(" · ")}</p>}
      <ZonePhotos photos={zone.photos} zoneName={zone.name} />
      <AreaTodo todo={zone.todo} />
      {zone.notes && <p className="rounded-lg border border-amber-400/50 bg-amber-50/60 p-2.5 text-sm dark:bg-amber-950/30">{zone.notes}</p>}
      {tools.length > 0 && state.status !== "done" && (
        <p className="text-sm">
          <span className="font-medium">Tools: </span>
          {tools.join(", ")}
          {state.status === "working" && state.kits.length > 0 && <span className="text-muted-foreground"> · kit {state.kits.join(", ")} is already here</span>}
          {state.status === "open" && state.wouldTake.length > 0 && <span className="text-muted-foreground"> · grab kit {state.wouldTake.join(", ")}</span>}
        </p>
      )}
    </>
  );
}

/** The one button on an area that is not yours yet, or why there isn't one. */
function StartButton({ state, stage, pending, onStart }: { state: AreaState; stage: "prep" | "work"; pending: boolean; onStart: () => void }) {
  if (state.status === "done") return <PhotoDone label="Done. After photo in." />;
  if (stage === "prep" && state.prepped) return <PhotoDone label="Prepped. The install starts once every area is prepped." />;
  if (state.status === "waiting") return <p className="text-sm text-amber-700">{state.waitingReason} Pick another area for now.</p>;
  const label =
    state.status === "working"
      ? `Join ${state.people.map((p) => p.name).join(" and ")} here`
      : stage === "prep"
        ? "Start prep here"
        : "Start the install";
  return (
    <Button type="button" className="h-12 w-full text-base font-semibold shadow-lg" onClick={onStart} disabled={pending}>
      {pending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
      {label}
    </Button>
  );
}

/** What the area buttons do. The server's, or a demo's that changes nothing real. */
export interface AreaActions {
  start: (zoneId: string) => Promise<{ ok: boolean; message?: string }>;
  leave: () => Promise<{ ok: boolean; message?: string }>;
  tick: (zoneId: string, key: string, done: boolean) => Promise<{ ok: boolean; message?: string }>;
  /** Null: the real camera and upload. */
  photo: ((zoneId: string, kind: "during" | "after") => Promise<{ ok: boolean; message?: string }>) | null;
}

const PHASE_HEADING: Record<Phase, string> = {
  prep: "Prep this area",
  work: "The install",
  cleanup: "Clean up",
};

/**
 * The area you are in: only the steps you are on now, ticked one by one,
 * then the one photo that closes them. Prep, then the prep photo. Once
 * every area is prepped: the install, the clean up, then the after photo.
 */
function InArea({
  jobId,
  zone,
  number,
  state,
  everyAreaPrepped,
  steps,
  tips,
  tools,
  meId,
  pending,
  onTick,
  onLeave,
  onPhoto,
  onError,
  demoPhoto,
}: {
  jobId: string;
  zone: WorkOrderZone;
  number: number;
  state: AreaState;
  everyAreaPrepped: boolean;
  steps: AreaBoardData["steps"][string];
  tips: AreaBoardData["tips"][string];
  tools: string[];
  meId: string | null;
  pending: boolean;
  onTick: (key: string, value: boolean) => void;
  onLeave: () => void;
  onPhoto: () => void;
  onError: (message: string | null) => void;
  demoPhoto: ((kind: "during" | "after") => void) | null;
}) {
  const ticked = new Set(steps.filter((s) => s.doneBy).map((s) => s.step.key));
  const list = steps.map((s) => s.step);
  const allTicked = (phase: Phase) => steps.filter((s) => s.step.phase === phase).every((s) => s.doneBy);

  // Where this area is: the first phase not finished, or the photo it waits on.
  const phase: Phase = !allTicked("prep") || !state.hasDuring ? "prep" : !allTicked("work") ? "work" : "cleanup";
  const photo: "during" | "after" | null = phase === "prep" && allTicked("prep") && !state.hasDuring ? "during" : phase === "cleanup" && allTicked("cleanup") && !state.hasAfter ? "after" : null;
  const inPhase = steps.filter((s) => s.step.phase === phase);
  const others = state.people.filter((p) => p.profileId !== meId);

  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-card/80 p-3 backdrop-blur-md">
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: zone.color }}>
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{zone.name}</p>
          <p className="text-xs text-muted-foreground">
            You{others.length > 0 ? ` and ${others.map((p) => p.name).join(", ")}` : ""}
            {state.kits.length > 0 && ` · kit ${state.kits.join(", ")}`}
          </p>
        </div>
        {zone.photos[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={canvasImageUrl(zone.photos[0].path, THUMBNAIL)} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold">{PHASE_HEADING[phase]}</p>
        <p className="text-xs text-muted-foreground">Tick each one as it&apos;s done.</p>
        {inPhase.map(({ step, doneBy }) => {
          const allowed = doneBy ? { ok: true as const } : canTick(step, list, ticked, state.hasDuring, everyAreaPrepped);
          return (
            <button
              key={step.key}
              type="button"
              disabled={pending}
              onClick={() => (allowed.ok ? onTick(step.key, !doneBy) : onError(allowed.reason))}
              className="flex min-h-11 items-start gap-2.5 rounded-lg border border-border bg-background/70 px-2.5 py-2 text-left text-sm hover:bg-accent/40"
            >
              {doneBy ? <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
              <span className={`flex-1 ${doneBy ? "text-muted-foreground line-through" : ""}`}>{step.label}</span>
              {doneBy && <span className="shrink-0 text-xs text-muted-foreground">{doneBy}</span>}
            </button>
          );
        })}
      </div>

      {photo && <PhotoTaker jobId={jobId} zone={zone} kind={photo} disabled={pending} onDone={onPhoto} onError={onError} demo={demoPhoto ? () => demoPhoto(photo) : null} />}

      <details className="rounded-lg border border-border bg-background/60 p-2.5">
        <summary className="cursor-pointer text-sm font-medium">The whole scope for this area</summary>
        <div className="mt-2 flex flex-col gap-3">
          <Scope zone={zone} tools={tools} state={state} />
        </div>
      </details>

      {tips.length > 0 && (
        <details className="rounded-lg border border-border bg-background/60 p-2.5">
          <summary className="cursor-pointer text-sm font-medium">What to look for</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {tips.map((tip) => (
              <li key={tip.title} className="text-sm">
                <span className="font-medium">{tip.title}. </span>
                <span className="text-muted-foreground">{tip.body}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <button type="button" onClick={onLeave} disabled={pending} className="self-start text-xs text-muted-foreground hover:text-primary">
        Leave this area
      </button>
    </div>
  );
}

function PhotoDone({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50/70 px-2.5 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
      <Camera className="h-4 w-4" /> {label}
    </p>
  );
}

/** The one photo that closes a phase: the prep photo after prep, the after photo after clean up. */
function PhotoTaker({
  jobId,
  zone,
  kind,
  disabled,
  onDone,
  onError,
  demo = null,
}: {
  jobId: string;
  zone: WorkOrderZone;
  kind: "during" | "after";
  disabled: boolean;
  onDone: () => void;
  onError: (message: string | null) => void;
  /** For a demo: the button counts the photo as taken, and nothing is uploaded. */
  demo?: (() => void) | null;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    onError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${jobId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file, { contentType: file.type || undefined });
      if (error) return onError("Couldn't upload that photo. Check your signal and try again.");
      const result = await attachJobPhoto(jobId, path, kind, null, { id: zone.id, name: zone.name });
      if (!result.ok) return onError(result.message);
      await areaPhotoTaken(jobId, zone.id);
      onDone();
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="sticky bottom-2 z-10 rounded-lg border border-dashed border-primary/60 bg-card p-2.5 shadow-lg">
      <p className="text-sm font-semibold">{kind === "during" ? "Prep done: take the prep photo" : "Clean up done: take the after photo"}</p>
      <p className="text-xs text-muted-foreground">
        {kind === "during" ? "One photo of the whole area, prepped. Then on to the next area." : "One photo of the finished area, from the same spot. This finishes it."}
      </p>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void upload(e.target.files)} />
      <Button type="button" className="mt-2 h-12 w-full text-base font-semibold" onClick={() => (demo ? demo() : input.current?.click())} disabled={disabled || uploading}>
        {uploading ? <Loader2 className="mr-1.5 h-5 w-5 animate-spin" /> : <Camera className="mr-1.5 h-5 w-5" />}
        {uploading ? "Uploading…" : kind === "during" ? "Take the prep photo" : "Take the after photo"}
      </Button>
    </div>
  );
}
