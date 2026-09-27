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
import { PHASE_LABEL, canTick, type AreaState, type Phase } from "@/lib/area-work";
import type { AreaBoardData } from "@/lib/data/area-board";
import type { WorkOrderZone } from "@/lib/work-order";

const PHASES: Phase[] = ["prep", "work", "cleanup"];

/**
 * The job on site, area by area.
 *
 * Every area with who is in it, what stage it is at and which kit it has.
 * Tap one to see what to do there. Start it, or join whoever is in it, and
 * tick the steps as they are done: prep, then a during photo, then the work
 * and the clean up, then the after photo, which finishes the area and gives
 * its kits back. An area whose kit is in use elsewhere waits, and says where.
 */
export function AreaBoard({
  jobId,
  zones,
  board,
  accountManager,
}: {
  jobId: string;
  zones: WorkOrderZone[];
  board: AreaBoardData;
  accountManager: { name: string; phone: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(board.myZoneId);

  const stateOf = new Map(board.states.map((s) => [s.zoneId, s]));
  const numberOf = new Map(zones.map((z, i) => [z.id, i + 1]));
  const done = board.states.filter((s) => s.status === "done").length;

  // Workable areas first, finished ones last: the ones that can be picked
  // are the ones worth reading.
  const order: Record<AreaState["status"], number> = { working: 0, open: 1, waiting: 2, done: 3 };
  const sorted = [...zones].sort((a, b) => {
    const mine = (z: WorkOrderZone) => (z.id === board.myZoneId ? -1 : 0);
    return mine(a) - mine(b) || order[stateOf.get(a.id)?.status ?? "open"] - order[stateOf.get(b.id)?.status ?? "open"] || (numberOf.get(a.id)! - numberOf.get(b.id)!);
  });

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "That didn't work. Try again.");
      router.refresh();
    });
  }

  if (zones.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold">The areas</h2>
        <p className="text-xs text-muted-foreground">
          {done} of {zones.length} done
        </p>
      </div>

      {!board.myZoneId && done === 0 && accountManager && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          Questions before you start? Ask {accountManager.name}.
          {accountManager.phone && (
            <a href={`tel:${accountManager.phone}`} className="flex items-center gap-1 font-medium text-primary">
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
          )}
        </p>
      )}

      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      <ol className="flex flex-col gap-2">
        {sorted.map((zone) => {
          const state = stateOf.get(zone.id)!;
          const mine = zone.id === board.myZoneId;
          const expanded = open === zone.id;
          return (
            <li
              key={zone.id}
              className={`rounded-xl border bg-card/80 backdrop-blur-md ${mine ? "border-2 border-primary" : state.status === "waiting" || state.status === "done" ? "border-border opacity-80" : "border-white/60"}`}
            >
              <button type="button" className="flex w-full items-start gap-2 p-3 text-left" onClick={() => setOpen(expanded ? null : zone.id)}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: zone.color }}>
                  {state.status === "done" ? <Check className="h-4 w-4" /> : numberOf.get(zone.id)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{zone.name}</span>
                  <span className="block text-sm text-primary">{zone.service}</span>
                  <StatusLine state={state} meId={board.meId} />
                </span>
                {/* The area as the evaluator saw it, so it can be found before it is opened. */}
                {!expanded && zone.photos[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={canvasImageUrl(zone.photos[0].path, THUMBNAIL)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" />
                )}
                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>

              {expanded && (
                <AreaDetail
                  jobId={jobId}
                  zone={zone}
                  state={state}
                  mine={mine}
                  steps={board.steps[zone.id] ?? []}
                  tips={board.tips[zone.id] ?? []}
                  tools={board.tools[zone.id] ?? []}
                  pending={pending}
                  onStart={() => run(() => startArea(jobId, zone.id))}
                  onLeave={() => run(() => leaveArea(jobId))}
                  onTick={(key, value) => run(() => tickAreaStep(jobId, zone.id, key, value))}
                  onPhoto={() => router.refresh()}
                  onError={setError}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StatusLine({ state, meId }: { state: AreaState; meId: string | null }) {
  if (state.status === "done") return <span className="mt-0.5 block text-xs text-emerald-700">Done</span>;
  if (state.status === "waiting") {
    return (
      <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
        <Lock className="h-3 w-3" /> {state.waitingReason}
      </span>
    );
  }
  const phase = state.phase === "done" ? "Photos" : PHASE_LABEL[state.phase];
  if (state.status === "working") {
    return (
      <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        <Users className="h-3 w-3" />
        {state.people.map((p) => (p.profileId === meId ? "You" : p.name)).join(", ")}
        {" · "}
        {phase} · {state.stepsDone}/{state.stepsTotal}
        {state.kits.length > 0 && ` · kit ${state.kits.join(", ")}`}
      </span>
    );
  }
  return (
    <span className="mt-0.5 block text-xs text-muted-foreground">
      Open{state.wouldTake.length > 0 ? ` · takes kit ${state.wouldTake.join(", ")}` : ""}
      {state.stepsDone > 0 ? ` · ${state.stepsDone}/${state.stepsTotal} done` : ""}
    </span>
  );
}

function AreaDetail({
  jobId,
  zone,
  state,
  mine,
  steps,
  tips,
  tools,
  pending,
  onStart,
  onLeave,
  onTick,
  onPhoto,
  onError,
}: {
  jobId: string;
  zone: WorkOrderZone;
  state: AreaState;
  mine: boolean;
  steps: AreaBoardData["steps"][string];
  tips: AreaBoardData["tips"][string];
  tools: string[];
  pending: boolean;
  onStart: () => void;
  onLeave: () => void;
  onTick: (key: string, value: boolean) => void;
  onPhoto: () => void;
  onError: (message: string | null) => void;
}) {
  const ticked = new Set(steps.filter((s) => s.doneBy).map((s) => s.step.key));
  const list = steps.map((s) => s.step);

  return (
    <div className="flex flex-col gap-3 border-t border-border px-3 pb-3 pt-3">
      {/* What to do here, from the evaluation. */}
      {(zone.location || zone.sizeLabel) && (
        <p className="text-xs text-muted-foreground">{[zone.location, zone.sizeLabel].filter(Boolean).join(" · ")}</p>
      )}
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

      {state.status === "waiting" && <p className="text-sm text-amber-700">{state.waitingReason} Pick another area for now.</p>}

      {!mine && (state.status === "open" || state.status === "working") && (
        <Button type="button" className="h-11" onClick={onStart} disabled={pending}>
          {state.status === "working" ? `Join ${state.people.map((p) => p.name).join(" and ")} here` : "Start this area"}
        </Button>
      )}

      {/* The checklist, phase by phase, with the photo that closes each. */}
      {(mine || state.status === "working" || state.stepsDone > 0 || state.status === "done") && (
        <div className="flex flex-col gap-3">
          {PHASES.map((phase) => {
            const inPhase = steps.filter((s) => s.step.phase === phase);
            if (inPhase.length === 0) return null;
            return (
              <div key={phase} className="flex flex-col gap-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{PHASE_LABEL[phase]}</p>
                {inPhase.map(({ step, doneBy }) => {
                  const allowed = doneBy ? { ok: true as const } : canTick(step, list, ticked, state.hasDuring);
                  return (
                    <button
                      key={step.key}
                      type="button"
                      disabled={pending || !mine || state.status === "done"}
                      onClick={() => (allowed.ok ? onTick(step.key, !doneBy) : onError(allowed.reason))}
                      className="flex min-h-10 items-start gap-2 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      {doneBy ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${allowed.ok ? "text-muted-foreground" : "text-muted-foreground/40"}`} />}
                      <span className={`flex-1 ${doneBy ? "text-muted-foreground line-through" : allowed.ok ? "" : "text-muted-foreground/70"}`}>{step.label}</span>
                      {doneBy && <span className="shrink-0 text-xs text-muted-foreground">{doneBy}</span>}
                    </button>
                  );
                })}
                {phase === "prep" && (state.hasDuring ? <PhotoDone label="During photo in" /> : state.photoDue === "during" && <PhotoTaker jobId={jobId} zone={zone} kind="during" disabled={pending} onDone={onPhoto} onError={onError} />)}
                {phase === "cleanup" && (state.hasAfter ? <PhotoDone label="After photo in. Area done." /> : state.photoDue === "after" && <PhotoTaker jobId={jobId} zone={zone} kind="after" disabled={pending} onDone={onPhoto} onError={onError} />)}
              </div>
            );
          })}
        </div>
      )}

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

      {mine && state.status !== "done" && (
        <button type="button" onClick={onLeave} disabled={pending} className="self-start text-xs text-muted-foreground hover:text-primary">
          Leave this area
        </button>
      )}
    </div>
  );
}

function PhotoDone({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50/70 px-2 py-1.5 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
      <Camera className="h-3.5 w-3.5" /> {label}
    </p>
  );
}

/** One photo for the area, whoever takes it. The during after prep, the after after clean up. */
function PhotoTaker({
  jobId,
  zone,
  kind,
  disabled,
  onDone,
  onError,
}: {
  jobId: string;
  zone: WorkOrderZone;
  kind: "during" | "after";
  disabled: boolean;
  onDone: () => void;
  onError: (message: string | null) => void;
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
      await areaPhotoTaken(jobId, zone.id, kind);
      onDone();
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-primary/60 bg-primary/5 p-2.5">
      <p className="text-sm font-semibold">{kind === "during" ? "Prep done: take the during photo" : "Clean up done: take the after photo"}</p>
      <p className="text-xs text-muted-foreground">
        {kind === "during" ? "One photo of the area, prepped. The work unlocks once it is in." : "One photo of the finished area. This finishes the area and frees its kit."}
      </p>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void upload(e.target.files)} />
      <Button type="button" className="mt-2 w-full" onClick={() => input.current?.click()} disabled={disabled || uploading}>
        {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
        {uploading ? "Uploading…" : kind === "during" ? "Take the during photo" : "Take the after photo"}
      </Button>
    </div>
  );
}
