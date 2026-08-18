"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Camera, Check, CheckCircle2, ImagePlus, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  attachJobPhoto,
  completeJob,
  deleteJobPhoto,
  reopenCompletedJob,
} from "@/lib/actions/job-photo-actions";
import { canCompleteJob, PHOTO_KIND_LABELS, zoneCoverage, type ZoneRef } from "@/lib/job-lifecycle";
import type { JobPhotoWithUrl } from "@/lib/data/job-photos";
import { REQUIRED_STAGES } from "@/types/domain";
import type { JobPhotoKind, JobStatus } from "@/types/domain";

const KINDS: JobPhotoKind[] = ["before", "during", "after", "issue"];

/**
 * Signing a job off, zone by zone.
 *
 * Organised around the zones rather than one pile of photos, because a pile
 * proves somebody was on site and proves nothing about any particular piece of
 * work — the patio, the bed and the drainage run all land in the same heap and
 * the one zone nobody shot is invisible.
 *
 * Phone-first: this gets used standing in the zone being photographed, so the
 * camera opens straight to the rear lens and each zone carries its own upload
 * controls rather than making somebody scroll back to a shared one.
 */
export function CompletionPanel({
  jobId,
  status,
  photos,
  zones,
  allowDuring,
  allowAfter,
  allowSignOff,
  signOffLockReason,
  completedAt,
  completedByName,
  completionNotes,
}: {
  jobId: string;
  status: JobStatus;
  photos: JobPhotoWithUrl[];
  zones: ZoneRef[];
  /** Which stages this job is far enough along to accept. A during or after
   * photo of work nobody has started is a record of something that did not
   * happen. */
  allowDuring: boolean;
  allowAfter: boolean;
  allowSignOff: boolean;
  signOffLockReason: string | null;
  completedAt: string | null;
  completedByName: string | null;
  completionNotes: string | null;
}) {
  const [items, setItems] = useState(photos);
  const [notes, setNotes] = useState(completionNotes ?? "");
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDone = status === "completed";
  // Only the stages this job has reached. 'issue' rides with 'during', since
  // finding a problem means somebody is on site.
  const offered = KINDS.filter(
    (k) =>
      k === "before" ||
      (k === "during" && allowDuring) ||
      (k === "issue" && allowDuring) ||
      (k === "after" && allowAfter)
  );

  const coverageVerdict = canCompleteJob({ status }, items, zones);
  const verdict = allowSignOff
    ? coverageVerdict
    : ({ ok: false, reason: signOffLockReason ?? "Not yet." } as const);
  const coverage = zoneCoverage(zones, items);
  const doneZones = coverage.filter((z) => z.complete).length;

  /**
   * Uploads straight from the browser to storage, then records the row.
   *
   * A site photo off a phone is several megabytes; routing it through a server
   * action would hold it in memory twice and hit the body limit on exactly the
   * jobs with the most to show.
   */
  async function upload(files: FileList | null, kind: JobPhotoKind, zone: ZoneRef | null) {
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

        const result = await attachJobPhoto(jobId, path, kind, null, zone);
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
            zone_id: zone?.id ?? null,
            zoneId: zone?.id ?? null,
            zone_name: zone?.name ?? null,
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

  const jobWide = items.filter((p) => p.zoneId == null);

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Camera className="h-4 w-4" />
          Completion &amp; photos
        </h2>
        {zones.length > 0 && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              doneZones === zones.length
                ? "border-emerald-600/40 bg-emerald-50 text-emerald-800"
                : "border-border bg-secondary/60 text-muted-foreground"
            }`}
          >
            {doneZones} of {zones.length} zones documented
          </span>
        )}
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

      {zones.length === 0 && (
        <p className="mb-3 rounded-lg border border-amber-400/60 bg-amber-50/60 px-3 py-2 text-xs">
          No zones drawn on this job yet. Draw them below and each one gets its own
          before/during/after. Until then one &ldquo;after&rdquo; photo of the job is enough to
          sign off.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {zones.map((zone) => (
          <ZoneSection
            key={zone.id}
            zone={zone}
            coverage={coverage.find((c) => c.zoneId === zone.id)!}
            photos={items.filter((p) => p.zoneId === zone.id)}
            editable={!isDone}
            uploading={uploading > 0}
            offered={offered}
            onUpload={(files, kind) => upload(files, kind, zone)}
            onRemoved={(id) => setItems((c) => c.filter((p) => p.id !== id))}
          />
        ))}

        <ZoneSection
          zone={null}
          coverage={null}
          photos={jobWide}
          editable={!isDone}
          uploading={uploading > 0}
          offered={offered}
          onUpload={(files, kind) => upload(files, kind, null)}
          onRemoved={(id) => setItems((c) => c.filter((p) => p.id !== id))}
        />
      </div>

      {uploading > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Uploading {uploading}…
        </p>
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
                  const result = await completeJob(jobId, notes, zones);
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

/** One zone's three stages, or the job-wide bucket when `zone` is null. */
function ZoneSection({
  zone,
  coverage,
  photos,
  editable,
  uploading,
  offered,
  onUpload,
  onRemoved,
}: {
  zone: ZoneRef | null;
  coverage: ReturnType<typeof zoneCoverage>[number] | null;
  photos: JobPhotoWithUrl[];
  editable: boolean;
  uploading: boolean;
  /** The stages this job is far enough along to accept. */
  offered: JobPhotoKind[];
  onUpload: (files: FileList | null, kind: JobPhotoKind) => void;
  onRemoved: (id: string) => void;
}) {
  const [kind, setKind] = useState<JobPhotoKind>(
    coverage?.missing.find((m) => offered.includes(m)) ?? offered[0] ?? "before"
  );
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  // The job-wide bucket is only worth showing when it holds something or
  // there are no zones to file things under.
  if (!zone && photos.length === 0 && !editable) return null;

  return (
    <div
      className={`rounded-lg border p-3 ${
        coverage?.complete ? "border-emerald-600/40 bg-emerald-50/30" : "border-border"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm font-semibold">{zone ? zone.name : "Whole job"}</p>
        {coverage && (
          <div className="flex items-center gap-1">
            {REQUIRED_STAGES.map((stage) => (
              <span
                key={stage}
                className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                  coverage.have[stage]
                    ? "border-emerald-600/40 bg-emerald-100 text-emerald-800"
                    : "border-border text-muted-foreground"
                }`}
              >
                {coverage.have[stage] && <Check className="h-2.5 w-2.5" />}
                {PHOTO_KIND_LABELS[stage]}
              </span>
            ))}
          </div>
        )}
      </div>

      {editable && offered.length > 0 && (
        <>
          <div
            className={`mb-2 grid gap-1.5 ${
              offered.length >= 4 ? "grid-cols-4" : offered.length === 3 ? "grid-cols-3" : "grid-cols-2"
            }`}
          >
            {offered.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={`min-h-10 rounded-lg border text-xs font-medium ${
                  kind === option
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {PHOTO_KIND_LABELS[option]}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
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
                onUpload(e.target.files, kind);
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
                onUpload(e.target.files, kind);
                e.target.value = "";
              }}
            />

            <Button
              type="button"
              size="sm"
              className="min-h-11 flex-1"
              disabled={uploading}
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="mr-1.5 h-4 w-4" />
              {PHOTO_KIND_LABELS[kind]} photo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={uploading}
              onClick={() => libraryRef.current?.click()}
              aria-label="Choose from library"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {photos.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {photos.map((photo) => (
            <PhotoTile key={photo.id} photo={photo} editable={editable} onRemoved={() => onRemoved(photo.id)} />
          ))}
        </ul>
      )}
    </div>
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
        <div className="flex aspect-square w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
          No preview
        </div>
      )}

      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-semibold text-white">
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
          className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded bg-black/60 text-white hover:bg-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </li>
  );
}
