"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Check, CheckCircle2, Loader2, MapPin, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { PROJECT_STEPS, stepState } from "@/lib/projects-today";
import { approveCrewPhoto, redoCrewPhoto } from "@/lib/actions/photo-review-actions";
import type { PhotoToReview, ProjectToday } from "@/lib/data/projects-today";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/**
 * Projects today: one card per project out, a bar for where it has got to,
 * anything wrong, and the crew's photos to approve or send back.
 */
export function ProjectsToday({ projects }: { projects: ProjectToday[] }) {
  const issues = projects.reduce((n, p) => n + p.issues.length, 0);
  const photos = projects.reduce((n, p) => n + p.photos.length, 0);
  if (projects.length === 0) {
    return <p className="rounded-xl border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">No projects out today.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {projects.length} out
        {issues > 0 ? ` · ${issues} ${issues === 1 ? "issue" : "issues"}` : ""}
        {photos > 0 ? ` · ${photos} ${photos === 1 ? "photo" : "photos"} to approve` : ""}
      </p>
      <ul className="flex flex-col gap-3">
        {projects.map((p) => (
          <ProjectCard key={p.jobId} project={p} />
        ))}
      </ul>
    </div>
  );
}

function ProjectCard({ project: p }: { project: ProjectToday }) {
  const walk = p.step === 6;
  return (
    <li className={cn("rounded-2xl border bg-card p-3 shadow-sm", p.issues.length > 0 ? "border-red-400" : walk ? "border-emerald-400" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/jobs/${p.jobId}`} className="min-w-0">
          <p className="font-semibold">{p.client}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {p.address}
              {p.crew.length > 0 ? ` · ${p.crew.join(", ")}` : ""}
            </span>
          </p>
        </Link>
        {p.issues.length > 0 ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
            <AlertTriangle className="h-3 w-3" /> {p.issues.length} {p.issues.length === 1 ? "issue" : "issues"}
          </span>
        ) : walk ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3 w-3" /> Ready to walk
          </span>
        ) : null}
      </div>

      <div className="mt-3" aria-label={`Step: ${p.step >= 0 ? (PROJECT_STEPS as readonly string[])[p.step] : "not started"}`}>
        <div className="flex gap-1">
          {PROJECT_STEPS.map((s, i) => {
            const state = stepState(i, p.step);
            return <div key={s} className={cn("h-2.5 flex-1 rounded-full", state === "done" ? "bg-emerald-500" : state === "now" ? "animate-pulse bg-sky-500" : "bg-muted")} />;
          })}
        </div>
        <div className="mt-1 flex gap-1">
          {PROJECT_STEPS.map((s, i) => {
            const state = stepState(i, p.step);
            return (
              <span
                key={s}
                className={cn(
                  "flex-1 text-center text-[10px] leading-tight",
                  state === "now" ? "font-semibold text-foreground" : state === "done" ? "text-emerald-700" : "text-muted-foreground"
                )}
              >
                {s}
              </span>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-sm">
        <span className="font-medium">{p.now}</span>
        {p.since && <span className="text-xs text-muted-foreground"> since {time(p.since)}</span>}
      </p>
      {p.areasTotal > 0 && p.step >= 4 && (
        <p className="text-xs text-muted-foreground">
          Areas: {p.areasDone} of {p.areasTotal} done
        </p>
      )}
      {p.issues.map((issue) => (
        <p key={issue} className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-800">
          {issue}
        </p>
      ))}

      {p.photos.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/70 p-2">
          <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-amber-900">
            <Camera className="h-3.5 w-3.5" /> {p.photos.length} {p.photos.length === 1 ? "photo" : "photos"} to approve
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {p.photos.map((photo) => (
              <PhotoTile key={photo.id} jobId={p.jobId} photo={photo} />
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function PhotoTile({ jobId, photo }: { jobId: string; photo: PhotoToReview }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [redo, setRedo] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(task: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    start(async () => {
      const result = await task();
      if (!result.ok) setError(result.message ?? "That didn't go through.");
      else router.refresh();
    });
  }

  return (
    <div className="w-32 shrink-0">
      <a href={photo.url ?? "#"} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] overflow-hidden rounded-lg bg-muted">
        {photo.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={`${photo.kind} photo${photo.zone ? `, ${photo.zone}` : ""}`} className="h-full w-full object-cover" />
        )}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{photo.kind}</span>
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
          {photo.zone ? `${photo.zone} · ` : ""}
          {time(photo.takenAt)}
        </span>
      </a>
      {redo ? (
        <div className="mt-1 flex flex-col gap-1">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What to redo"
            className="h-8 rounded-md border border-border bg-background px-1.5 text-xs"
          />
          <div className="grid grid-cols-2 gap-1">
            <button type="button" disabled={pending} onClick={() => run(() => redoCrewPhoto(jobId, photo.id, note))} className="rounded-md bg-amber-600 py-1 text-[11px] font-semibold text-white">
              Send back
            </button>
            <button type="button" disabled={pending} onClick={() => setRedo(false)} className="rounded-md border border-border bg-background py-1 text-[11px]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-2 gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveCrewPhoto(jobId, photo.id))}
            className="flex items-center justify-center gap-0.5 rounded-md bg-emerald-600 py-1 text-[11px] font-semibold text-white"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} OK
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRedo(true)}
            className="flex items-center justify-center gap-0.5 rounded-md border border-border bg-background py-1 text-[11px] font-semibold"
          >
            <RotateCcw className="h-3 w-3" /> Redo
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
