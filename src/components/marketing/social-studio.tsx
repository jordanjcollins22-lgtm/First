"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { CalendarClock, Check, Loader2, Send, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { approveSocialPost, markPosted, skipSocialPost } from "@/lib/actions/social-actions";
import { renderBeforeAfter } from "@/lib/social-canvas";
import { describeSlot, suggestCaption } from "@/lib/social-post";
import type { PostCandidate, SocialPost } from "@/lib/data/social";

const BUCKET = "social-posts";
const PHONE = "443-819-1521";

/**
 * Where finished work becomes posts.
 *
 * Three lists, in the order the work moves: pairs waiting to be looked at,
 * posts with a time on them, and posts that have gone out. Nothing here
 * happens without somebody pressing approve — these are photographs of
 * customers' houses, and the approval is the point.
 */
export function SocialStudio({
  candidates,
  posts,
}: {
  candidates: PostCandidate[];
  posts: SocialPost[];
}) {
  const [making, setMaking] = useState<PostCandidate | null>(null);
  const router = useRouter();

  const scheduled = posts.filter((p) => p.status === "scheduled");
  const posted = posts.filter((p) => p.status === "posted");

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:py-6">
      <h1 className="text-2xl font-bold">Before &amp; after posts</h1>
      <p className="text-sm text-muted-foreground">
        Made from the photos the crew already takes. Approve one and it gets a time on its own,
        spaced out from everything already booked.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Waiting" value={String(candidates.length)} />
        <Stat label="Scheduled" value={String(scheduled.length)} />
        <Stat label="Posted" value={String(posted.length)} />
      </div>

      <Section title={`Waiting on you (${candidates.length})`}>
        {candidates.length === 0 ? (
          <Empty>
            Nothing waiting. Pairs show up here once a crew has uploaded a before and an after of
            the same zone.
          </Empty>
        ) : (
          <div className="space-y-2">
            {candidates.map((candidate) => (
              <CandidateRow
                key={`${candidate.beforePhotoId}:${candidate.afterPhotoId}`}
                candidate={candidate}
                onMake={() => setMaking(candidate)}
                onSkipped={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title={`Scheduled (${scheduled.length})`}>
        {scheduled.length === 0 ? (
          <Empty>Nothing queued yet.</Empty>
        ) : (
          <div className="space-y-2">
            {scheduled.map((post) => (
              <PostRow key={post.id} post={post} onChanged={() => router.refresh()} />
            ))}
          </div>
        )}
      </Section>

      {posted.length > 0 && (
        <Section title={`Posted (${posted.length})`}>
          <div className="space-y-2">
            {posted.map((post) => (
              <PostRow key={post.id} post={post} onChanged={() => router.refresh()} />
            ))}
          </div>
        </Section>
      )}

      {making && (
        <MakePostDialog
          candidate={making}
          onClose={() => setMaking(null)}
          onDone={() => {
            setMaking(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 px-3 py-2 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
      {children}
    </p>
  );
}

function CandidateRow({
  candidate,
  onMake,
  onSkipped,
}: {
  candidate: PostCandidate;
  onMake: () => void;
  onSkipped: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/60 bg-card/60 p-2 backdrop-blur-md">
      <div className="flex shrink-0 gap-1">
        <Thumb url={candidate.beforeUrl} label="Before" />
        <Thumb url={candidate.afterUrl} label="After" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{candidate.jobName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[candidate.zoneName, candidate.town].filter(Boolean).join(" · ") || "Whole job"}
        </p>
        <div className="mt-1 flex gap-1">
          <Button type="button" size="sm" onClick={onMake}>
            Make post
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await skipSocialPost({
                  jobId: candidate.jobId,
                  beforePhotoId: candidate.beforePhotoId,
                  afterPhotoId: candidate.afterPhotoId,
                });
                onSkipped();
              })
            }
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}

function Thumb({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <div className="flex h-16 w-14 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
        {label}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={label} className="h-16 w-14 rounded-md border border-border object-cover" />
  );
}

function PostRow({ post, onChanged }: { post: SocialPost; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/60 bg-card/60 p-2 backdrop-blur-md">
      {post.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.imageUrl}
          alt=""
          className="h-24 w-[76px] shrink-0 rounded-md border border-border object-cover"
        />
      ) : (
        <div className="h-24 w-[76px] shrink-0 rounded-md border border-dashed border-border" />
      )}

      <div className="min-w-0 flex-1">
        <Link href={`/jobs/${post.jobId}`} className="truncate text-sm font-medium hover:underline">
          {post.jobName ?? "Job"}
        </Link>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="h-3 w-3" />
          {post.status === "posted"
            ? post.postedAt
              ? `Posted ${describeSlot(post.postedAt)}`
              : "Posted"
            : post.scheduledFor
              ? describeSlot(post.scheduledFor)
              : "No time yet"}
        </p>
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs">{post.caption}</p>

        {post.status === "scheduled" && (
          <div className="mt-1 flex flex-wrap gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => post.caption && navigator.clipboard?.writeText(post.caption)}
            >
              Copy caption
            </Button>
            {post.imageUrl && (
              <Button type="button" size="sm" variant="outline" asChild>
                <a href={post.imageUrl} target="_blank" rel="noreferrer">
                  Open image
                </a>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markPosted(post.id, "manual");
                  onChanged();
                })
              }
            >
              <Send className="mr-1 h-3.5 w-3.5" />
              Mark posted
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The square, drawn, before anybody commits to it.
 *
 * The preview is the file: what is on the canvas is exactly what gets
 * uploaded, so approving cannot produce something the person approving never
 * saw.
 */
function MakePostDialog({
  candidate,
  onClose,
  onDone,
}: {
  candidate: PostCandidate;
  onClose: () => void;
  onDone: () => void;
}) {
  const previewRef = useRef<HTMLImageElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState(() =>
    suggestCaption({
      services: [candidate.jobName],
      zoneName: candidate.zoneName,
      city: candidate.town,
      phone: PHONE,
    })
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function draw() {
      if (!candidate.beforeUrl || !candidate.afterUrl) {
        setError("One of the photos wouldn't load.");
        return;
      }
      try {
        const made = await renderBeforeAfter({
          beforeUrl: candidate.beforeUrl,
          afterUrl: candidate.afterUrl,
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(made);
        setBlob(made);
        setPreviewUrl(objectUrl);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't draw that.");
      }
    }

    void draw();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [candidate.beforeUrl, candidate.afterUrl]);

  function approve() {
    if (!blob) return;
    setError(null);

    startTransition(async () => {
      try {
        const supabase = createClient();
        const path = `${candidate.jobId}/${uuid()}.png`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, blob, { contentType: "image/png" });
        if (uploadError) throw uploadError;

        const result = await approveSocialPost({
          jobId: candidate.jobId,
          beforePhotoId: candidate.beforePhotoId,
          afterPhotoId: candidate.afterPhotoId,
          zoneId: candidate.zoneId,
          zoneName: candidate.zoneName,
          imagePath: path,
          caption,
        });

        if (result.ok) onDone();
        else setError(result.message);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't approve that.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{candidate.jobName}</DialogTitle>
          <DialogDescription>
            {[candidate.zoneName, candidate.town].filter(Boolean).join(" · ") ||
              "This is exactly what goes out."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div
            className="mx-auto w-full max-w-[280px] overflow-hidden rounded-lg border border-border bg-muted"
            style={{ aspectRatio: "1080 / 1350" }}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img ref={previewRef} src={previewUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          <Textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={6}
            aria-label="Caption"
          />

          {error && (
            <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex gap-2">
            <Button type="button" className="flex-1" disabled={!blob || pending} onClick={approve}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Approve &amp; schedule
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Not now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
