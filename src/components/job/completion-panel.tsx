"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Camera, CheckCircle2, ImagePlus, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  attachJobPhoto,
  completeJob,
  deleteJobPhoto,
  reopenCompletedJob,
} from "@/lib/actions/job-photo-actions";
import { canCompleteJob, PHOTO_KIND_LABELS } from "@/lib/job-lifecycle";
import type { JobPhotoWithUrl } from "@/lib/data/job-photos";
import type { JobPhotoKind, JobStatus } from "@/types/domain";

const KINDS: JobPhotoKind[] = ["before", "after", "issue"];

/**
 * Signing a job off, with the photos that prove it.
 *
 * Built phone-first because this is used standing on the finished site, not
 * back at a desk: the camera button opens the rear camera directly, uploads
 * start the moment a photo is taken, and the sign-off button says exactly what
 * is missing rather than just refusing.
 */
export function CompletionPanel({
  jobId,
  status,
  photos,
  completedAt,
  completedByName,
  completionNotes,
}: {
  jobId: string;
  status: JobStatus;
  photos: JobPhotoWithUrl[];
  completedAt: string | null;
  completedByName: string | null;
  completionNotes: string | null;
}) {
  const [items, setItems] = useState(photos);
  const [kind, setKind] = useState<JobPhotoKind>("after");
  const [notes, setNotes] = useState(completionNotes ?? "");
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const verdict = canCompleteJob({ status }, items);
  const isDone = status === "completed";

  /**
   * Uploads straight from the browser to storage, then records the row.
   *
   * A site photo off a phone is several megabytes; routing it through a server
   * action would hold it in memory twice and hit the body limit on exactly the
   * jobs with the most to show.
   */
  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const chosen = Array.from(files);
    setUploading((n) => n + chosen.length);

    for (const file of chosen) {
      try {
        const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
        // First path segment is the job id — storage checks access against it.
        const path = `${jobId}/${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("job-photos")
          .upload(path, file, { contentType: file.type || undefined });
        if (uploadError) {
          setError("Couldn't upload that photo — check your signal and try again.");
          continue;
        }

        const result = await attachJobPhoto(jobId, path, kind, null);
        if (!result.ok) {
          setError(result.message);
          continue;
        }

        const { data: signed } = await supabase.storage
          .from("job-photos")
          .createSignedUrl(path, 60 * 60);

        setItems((current) => [
          ...current,
          {
            id: result.id,
            job_id: jobId,
            organization_id: "",
            path,
            kind,
            caption: null,
            uploaded_by: null,
            created_at: new Date().toISOString(),
            url: signed?.signedUrl ?? null,
            uploaderName: null,
          },
        ]);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const counts = KINDS.map((k) => ({ kind: k, count: items.filter((p) => p.kind === k).length }));

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Camera className="h-4 w-4" />
          Completion &amp; photos
        </h2>
        {counts
          .filter((c) => c.count > 0)
          .map((c) => (
            <span
              key={c.kind}
              className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {c.count} {PHOTO_KIND_LABELS[c.kind].toLowerCase()}
            </span>
          ))}
      </div>

      {isDone && (
        <div className="mb-3 rounded-lg border border-emerald-600/40 bg-emerald-50/60 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            Signed off
            {completedAt && ` ${new Date(completedAt).toLocaleDateString()}`}
            {completedByName && ` by ${completedByName}`}
          </p>
          {completionNotes && <p className="mt-1 text-muted-foreground">{completionNotes}</p>}
        </div>
      )}

      {/* ------------------------------------------------------------ upload */}
      {!isDone && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add photos as
          </p>
          <div className="mb-2 grid grid-cols-3 gap-2">
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={`min-h-11 rounded-lg border text-sm font-medium ${
                  kind === option
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {PHOTO_KIND_LABELS[option]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {/* capture opens the rear camera on a phone and is ignored on a
                desktop, where the second button is the useful one. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={libraryRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />

            <Button
              type="button"
              size="sm"
              className="min-h-11 flex-1 sm:flex-none"
              disabled={uploading > 0}
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="mr-1.5 h-4 w-4" />
              Take photo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              disabled={uploading > 0}
              onClick={() => libraryRef.current?.click()}
            >
              <ImagePlus className="mr-1.5 h-4 w-4" />
              Choose
            </Button>
          </div>

          {uploading > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading {uploading}…
            </p>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- gallery */}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No photos yet. At least one &ldquo;after&rdquo; shot is needed to sign this job off.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((photo) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              editable={!isDone}
              onRemoved={() => setItems((current) => current.filter((p) => p.id !== photo.id))}
            />
          ))}
        </ul>
      )}

      {/* --------------------------------------------------------- sign-off */}
      <div className="mt-4 border-t border-border pt-3">
        {isDone ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-9"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await reopenCompletedJob(jobId);
                if (result.ok) setMessage(result.message ?? "Reopened.");
                else setError(result.message);
              })
            }
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reopen for a callback
          </Button>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Sign-off note
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the office should know"
              />
            </label>

            <Button
              type="button"
              className="mt-2 min-h-11 w-full sm:w-auto"
              disabled={!verdict.ok || isPending || uploading > 0}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await completeJob(jobId, notes);
                  if (result.ok) setMessage(result.message ?? "Signed off.");
                  else setError(result.message);
                })
              }
            >
              {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Mark complete
            </Button>

            {!verdict.ok && <p className="mt-1.5 text-[11px] text-muted-foreground">{verdict.reason}</p>}
          </>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {message && <p className="mt-2 text-xs text-emerald-700">{message}</p>}
    </section>
  );
}

function PhotoTile({
  photo,
  editable,
  onRemoved,
}: {
  photo: JobPhotoWithUrl;
  editable: boolean;
  onRemoved: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <li className="relative overflow-hidden rounded-lg border border-border">
      {photo.url ? (
        <Image
          src={photo.url}
          alt={`${PHOTO_KIND_LABELS[photo.kind]} photo`}
          width={400}
          height={400}
          unoptimized
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted text-[11px] text-muted-foreground">
          Preview unavailable
        </div>
      )}

      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {PHOTO_KIND_LABELS[photo.kind]}
      </span>

      {editable && (
        <button
          type="button"
          disabled={isPending}
          aria-label="Remove photo"
          onClick={() =>
            startTransition(async () => {
              const result = await deleteJobPhoto(photo.id);
              if (result.ok) onRemoved();
            })
          }
          className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded bg-black/60 text-white hover:bg-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
