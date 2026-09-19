"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ClipboardCheck, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  addPhotoMark,
  approvePhotos,
  removePhotoMark,
  resolvePhotoMark,
  type ReviewResult,
} from "@/lib/actions/photo-review-actions";
import {
  canApprove,
  describeStatus,
  marksOnPhoto,
  openMarks,
  readyForWalkthrough,
  reviewStatus,
  summarise,
  type PhotoMark,
} from "@/lib/photo-review";
import { applyMarkEdit, provisionalMark, type MarkEdit } from "@/lib/photo-review-edits";
import type { JobPhotoWithUrl } from "@/lib/data/job-photos";

interface PhotoReviewPanelProps {
  jobId: string;
  /** The after shots — what the manager is being asked to sign off. */
  photos: JobPhotoWithUrl[];
  marks: PhotoMark[];
  crewSignedOff: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
  /** Managers mark and approve; the crew see the list and clear it. */
  canReview: boolean;
}

/**
 * The manager's check on the finished work.
 *
 * Tap a photo where something needs doing and say what — the note is asked
 * for in the same breath as the pin, because a pin somebody meant to explain
 * later is a pin nobody can act on.
 *
 * Approval is blocked while anything is outstanding. Booking a client
 * walkthrough over an unfinished punch list is how a customer gets shown the
 * one bed nobody went back to.
 *
 * Every change here lands on the screen before it lands in the database. The
 * marks are server-rendered, so a crew member clearing a five-item punch list
 * on site used to wait out a round trip per item and could not tell a slow
 * one from a tap that missed. The list now answers immediately and the server
 * catches up behind it; a refusal puts the mark back and says why, because a
 * punch list that quietly drops an item is worse than one that never moved.
 */
export function PhotoReviewPanel({
  jobId,
  photos,
  marks,
  crewSignedOff,
  approvedAt,
  approvedByName,
  canReview,
}: PhotoReviewPanelProps) {
  const router = useRouter();
  const [placing, setPlacing] = useState<{
    photo: JobPhotoWithUrl;
    x: number;
    y: number;
    /** Carried back in when a save was refused, so nobody retypes it. */
    note: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // React keeps both of these only while the transition runs, so they give way
  // to the server's answer the moment the refreshed page arrives, and undo
  // themselves if the action came back refusing.
  const [shownMarks, editMarks] = useOptimistic(marks, applyMarkEdit);
  const [shownApprovedAt, setApproved] = useOptimistic(approvedAt);

  const status = reviewStatus({ crewSignedOff, marks: shownMarks, approvedAt: shownApprovedAt });
  const outstanding = openMarks(shownMarks);

  if (status === "not_ready") return null;

  function run(show: () => void, work: () => Promise<ReviewResult>) {
    setError(null);
    startTransition(async () => {
      show();
      const result = await work();
      if (result.ok) {
        router.refresh();
        return;
      }
      // The screen is already back to what the server thinks by the time this
      // reads, so it is the reason and not an apology for a state nobody sees.
      setError(result.message);
    });
  }

  function edit(change: MarkEdit, work: () => Promise<ReviewResult>) {
    run(() => editMarks(change), work);
  }

  function save(note: string) {
    if (!placing) return;
    const { photo, x, y } = placing;
    const local = provisionalMark({
      id: `pending-${Date.now()}`,
      photoId: photo.id,
      x,
      y,
      note,
      at: new Date().toISOString(),
    });

    // Shut before the request goes out: the pin is the answer, and a dialog
    // sitting over the photo it refers to is the thing in the way of seeing it.
    setPlacing(null);
    run(
      () => editMarks({ kind: "added", mark: local }),
      async () => {
        const result = await addPhotoMark({ jobId, photoId: photo.id, x, y, note });
        // Refused: the pin is gone again, so the words that explained it come
        // back with the dialog rather than dying with it.
        if (!result.ok) setPlacing({ photo, x, y, note });
        return result;
      }
    );
  }

  return (
    <section className="mt-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4" />
          Photo review
        </h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            status === "approved"
              ? "border-emerald-600/40 bg-emerald-50 text-emerald-800"
              : status === "changes_requested"
                ? "border-amber-500/50 bg-amber-50 text-amber-800"
                : "border-border bg-secondary/60 text-muted-foreground"
          }`}
        >
          {summarise(shownMarks)}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {describeStatus(status)}
        {status === "approved" && approvedByName && ` Signed off by ${approvedByName}.`}
      </p>

      {readyForWalkthrough(status) && (
        <p className="mb-3 rounded-lg border border-emerald-600/40 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800">
          The work is signed off. Book the walkthrough with the client from the schedule panel above.
        </p>
      )}

      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No after photos to look at yet.</p>
      ) : (
        <>
          {canReview && (
            <p className="mb-2 text-xs text-muted-foreground">
              Tap a photo where something needs doing.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {photos.map((photo) => (
              <ReviewPhoto
                key={photo.id}
                photo={photo}
                marks={marksOnPhoto(shownMarks, photo.id)}
                canReview={canReview}
                onPlace={(x, y) => setPlacing({ photo, x, y, note: "" })}
              />
            ))}
          </div>
        </>
      )}

      {outstanding.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">What still needs doing</h3>
          <ol className="space-y-1">
            {outstanding.map((mark, index) => (
              <li
                key={mark.id}
                className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-50/50 px-2 py-1.5 text-sm"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive text-[11px] font-bold text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {mark.note}
                  {mark.authorName && (
                    <span className="text-muted-foreground"> — {mark.authorName}</span>
                  )}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  title="The crew have been back and done this"
                  onClick={() =>
                    edit({ kind: "resolved", id: mark.id, at: new Date().toISOString() }, () =>
                      resolvePhotoMark(jobId, mark.id)
                    )
                  }
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                {canReview && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    title="Take this mark back"
                    onClick={() =>
                      edit({ kind: "removed", id: mark.id }, () => removePhotoMark(jobId, mark.id))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Behind the dialog when one is open, so that one says it instead. */}
      {error && !placing && (
        <p className="mt-3 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-800">{error}</p>
      )}

      {canReview && status !== "approved" && (
        <Button
          type="button"
          className="mt-3"
          disabled={!canApprove(shownMarks)}
          title={canApprove(shownMarks) ? undefined : "Clear the touch-ups first"}
          onClick={() => run(() => setApproved(new Date().toISOString()), () => approvePhotos(jobId))}
        >
          <Check className="mr-2 h-4 w-4" />
          Looks right — approve
        </Button>
      )}

      {placing && (
        <MarkDialog
          key={`${placing.photo.id}:${placing.x}:${placing.y}`}
          initialNote={placing.note}
          error={error}
          onCancel={() => setPlacing(null)}
          onSave={save}
        />
      )}
    </section>
  );
}

function ReviewPhoto({
  photo,
  marks,
  canReview,
  onPlace,
}: {
  photo: JobPhotoWithUrl;
  marks: PhotoMark[];
  canReview: boolean;
  onPlace: (x: number, y: number) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      {/* Natural aspect, never cropped: a marker is a fraction of the image,
          and once the image is cropped a fraction of the container is
          somewhere else entirely. */}
      <button
        type="button"
        disabled={!canReview}
        className="block w-full"
        onClick={(event) => {
          if (!canReview) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onPlace((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        }}
      >
        {photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={photo.zone_name ?? "After"} className="block w-full" />
        ) : (
          <span className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            No preview
          </span>
        )}
      </button>

      {marks.map((mark, index) => (
        <span
          key={mark.id}
          style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
          className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-destructive text-[9px] font-bold text-white shadow-md"
        >
          {index + 1}
        </span>
      ))}

      <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[10px] font-semibold text-white">
        {photo.zone_name ?? "Whole job"}
      </span>
    </div>
  );
}

/**
 * What the pin means.
 *
 * Asked the moment the pin lands. A note somebody meant to write later is a
 * pin nobody can act on, so the mark does not exist until there is one.
 */
function MarkDialog({
  initialNote,
  error,
  onSave,
  onCancel,
}: {
  initialNote: string;
  /** Why the last attempt was refused, if it was. */
  error: string | null;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(initialNote);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
        <h2 className="text-lg font-semibold">What needs doing here?</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          What is wrong, and what the crew have to do about it.
        </p>

        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          autoFocus
          placeholder="Bed edge collapsed at the corner — re-cut and pack it."
        />

        {error && (
          <p className="mt-2 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-800">{error}</p>
        )}

        <div className="mt-3 flex gap-2">
          <Button type="button" className="flex-1" disabled={!note.trim()} onClick={() => onSave(note)}>
            Send to the crew
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
