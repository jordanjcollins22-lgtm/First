"use client";

/* eslint-disable @next/next/no-img-element -- sample photos, photos picked on this device and the app's own drawn pictures */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Ban, CalendarDays, Camera, CheckCircle2, Loader2, Play, Sparkles, Undo2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompletionPanel } from "@/components/job/completion-panel";
import { PhotoBacklog } from "@/components/marketing/photo-backlog";
import { ReadyToApprove, type QueueActions } from "@/components/marketing/ready-to-approve";
import { CadenceSummary, PostingHealthCard, UpcomingList } from "@/components/marketing/social-autopost-status";
import { describeHealth } from "@/lib/social/autopost";
import { DEFAULT_SOCIAL_CADENCE, PLATFORM_LABEL, slotTimes, type SocialPlatform } from "@/lib/social/cadence";
import { localWeekKey } from "@/lib/marketing/social-autopost";
import { DEFAULT_PHONE, approvalSlot, draftText, suggestSlot, type DraftShape } from "@/lib/social/photo-drafts";
import { cleanHashtags, type PlanText } from "@/lib/social-plan";
import { BUSINESS_TIME_ZONE, shortWhen } from "@/lib/time-zone";
import type { JobPhotoWithUrl } from "@/lib/data/job-photos";
import type { QueueItem } from "@/lib/data/social-photo-drafts";
import type { UpcomingPost } from "@/lib/data/social-autopost";
import type { JobPhotoKind } from "@/types/domain";

/**
 * The whole photo-to-post system on one page, with sample data: the crew
 * finishing a job, the photo backlog, the drafts being written, Ready to
 * approve, the week's slots and what was posted. The real screens, each
 * button run on this page only: nothing is saved, uploaded or posted.
 */

type Status = "writing" | "draft" | "scheduled" | "posted" | "failed" | "denied";

interface Post {
  id: string;
  /** Its number in Ready to approve: pp-draft-N. */
  n: number;
  source: string;
  shape: DraftShape;
  /** A sample photo set in public/review/photo-posts, or null for a photo picked on this device. */
  sample: string | null;
  /** The picked photo, for an upload. */
  photoUrl: string | null;
  jobNumber: number | null;
  text: PlanText;
  status: Status;
  /** Suggested time while a draft, the slot once approved, when it went out once posted. */
  at: string | null;
  sent: SocialPlatform[];
  /** When it went out, once posted. */
  postedAt: string | null;
  error: string | null;
  attempts: number;
}

const PLATFORMS: SocialPlatform[] = ["facebook", "instagram"];
const CADENCE = DEFAULT_SOCIAL_CADENCE;
const JOB = { number: 418, town: "Bel Air", service: "Mulching" };
const ZONES = [
  { id: "zone-front", name: "Front beds", sample: "front-beds" },
  { id: "zone-side", name: "Side yard", sample: "side-yard" },
];
const OK = { ok: true, message: "" };

function samplePhoto(sample: string, kind: JobPhotoKind) {
  return `/review/photo-posts/${sample}-${kind === "after" ? "after" : "before"}.jpg`;
}

/** The post's picture: drawn by the card route for the sample photos, the photo itself for one picked here. */
function pictureOf(p: Post): string {
  if (!p.sample) return p.photoUrl ?? "";
  const q = new URLSearchParams({ photo: p.sample, shape: p.shape === "pair" ? "pair" : "single", hook: p.text.hook });
  return `/review/photo-posts/card?${q}`;
}

function crewPhotos(at: string): JobPhotoWithUrl[] {
  const photo = (zone: (typeof ZONES)[number], kind: JobPhotoKind): JobPhotoWithUrl => ({
    id: `${zone.id}-${kind}`,
    job_id: "sample-job",
    organization_id: "",
    path: "",
    kind,
    zone_id: zone.id,
    zoneId: zone.id,
    zone_name: zone.name,
    caption: null,
    uploaded_by: null,
    created_at: at,
    url: samplePhoto(zone.sample, kind),
    uploaderName: null,
  });
  // The front beds are done; the side yard still needs its after photo.
  return [photo(ZONES[0], "before"), photo(ZONES[0], "during"), photo(ZONES[0], "after"), photo(ZONES[1], "before"), photo(ZONES[1], "during")];
}

function startingPosts(now: Date, bookingUrl: string): Post[] {
  const text = (shape: DraftShape, town: string, service: string) => draftText({ shape, town, service, bookingUrl });
  // The last two slots before now: one went out, one failed on Instagram.
  const past = slotTimes(CADENCE, new Date(now.getTime() - 9 * 86_400_000), 2)
    .filter((s) => s.rank < CADENCE.perWeek.facebook && s.at.getTime() < now.getTime())
    .slice(-2)
    .map((s) => s.at.toISOString());
  const posted: Post = {
    id: "post-409",
    n: 0,
    source: "From job #409",
    shape: "pair",
    sample: "side-yard",
    photoUrl: null,
    jobNumber: 409,
    text: text("pair", "Fallston", "Shrub trimming"),
    status: "posted",
    at: past[0] ?? null,
    sent: ["facebook", "instagram"],
    postedAt: past[0] ?? null,
    error: null,
    attempts: 1,
  };
  const failed: Post = {
    id: "post-412",
    n: 0,
    source: "From job #412",
    shape: "pair",
    sample: "leaf-cleanup",
    photoUrl: null,
    jobNumber: 412,
    text: text("pair", "Forest Hill", "Fall cleanup"),
    status: "failed",
    at: past[1] ?? null,
    sent: ["facebook"],
    postedAt: null,
    error: "Instagram couldn't fetch the picture (Meta error 2207052). Facebook went out.",
    attempts: 4,
  };
  const booked = [posted, failed].filter((p) => p.at).map((p) => ({ at: p.at!, platforms: PLATFORMS }));
  const waiting: Post = {
    id: "draft-1",
    n: 1,
    source: "Uploaded",
    shape: "upload",
    sample: "bed-edging",
    photoUrl: null,
    jobNumber: null,
    text: text("upload", "Forest Hill", "Bed edging"),
    status: "draft",
    at: suggestSlot(CADENCE, booked, now)?.toISOString() ?? null,
    sent: [],
    postedAt: null,
    error: null,
    attempts: 0,
  };
  return [waiting, failed, posted];
}

const bookings = (posts: Post[], except?: string) =>
  posts.filter((p) => p.id !== except && p.at && p.status !== "denied" && p.status !== "writing").map((p) => ({ at: p.at!, platforms: PLATFORMS }));

function Step({ id, n, title, line, children }: { id: string; n: number; title: string; line: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 border-t border-border pt-8">
      <div className="flex items-start gap-3 px-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0f766e] text-2xl font-extrabold text-white">{n}</span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-xl font-extrabold leading-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{line}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PhotoPostSystemDemo({ now: nowIso, bookingUrl }: { now: string; bookingUrl: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [posts, setPosts] = useState<Post[]>(() => startingPosts(now, bookingUrl));
  const [lastRunAt, setLastRunAt] = useState<string>(() => new Date(now.getTime() - 40 * 60_000).toISOString());
  const [crewKey, setCrewKey] = useState(0);
  const [running, setRunning] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const update = (id: string, patch: Partial<Post> | ((p: Post) => Partial<Post>)) =>
    setPosts((all) => all.map((p) => (p.id === id ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p)));

  /** A new draft: written for a moment, then waiting in Ready to approve with its suggested time. */
  function addDrafts(make: { source: string; shape: DraftShape; sample: string | null; photoUrl: string | null; jobNumber: number | null; town: string; service: string; note?: string }[]) {
    const ids: string[] = [];
    setPosts((all) => {
      const next = [...all];
      let n = Math.max(0, ...all.map((p) => p.n));
      for (const m of make) {
        const id = `draft-${Math.random().toString(36).slice(2, 9)}`;
        ids.push(id);
        const at = suggestSlot(CADENCE, bookings(next), now)?.toISOString() ?? null;
        next.unshift({
          id,
          n: ++n,
          source: m.source,
          shape: m.shape,
          sample: m.sample,
          photoUrl: m.photoUrl,
          jobNumber: m.jobNumber,
          text: draftText({ shape: m.shape, town: m.town || null, service: m.service || null, note: m.note || null, bookingUrl }),
          status: "writing",
          at,
          sent: [],
          postedAt: null,
          error: null,
          attempts: 0,
        });
      }
      return next;
    });
    timers.current.push(window.setTimeout(() => setPosts((all) => all.map((p) => (ids.includes(p.id) && p.status === "writing" ? { ...p, status: "draft" } : p))), 1200));
  }

  function finishJob() {
    // One post per job, never two.
    if (posts.some((p) => p.jobNumber === JOB.number)) return;
    addDrafts([{ source: `From job #${JOB.number}`, shape: "pair", sample: ZONES[0].sample, photoUrl: null, jobNumber: JOB.number, town: JOB.town, service: JOB.service }]);
  }

  const actions: QueueActions = {
    approve: async (id, edits) => {
      const post = posts.find((p) => p.id === id);
      if (!post) return { ok: false, message: "That draft is gone." };
      const at = approvalSlot({ cadence: CADENCE, suggested: post.at, booked: bookings(posts, id), platforms: PLATFORMS, now });
      update(id, (p) => ({ status: "scheduled", at: at?.toISOString() ?? null, text: { ...p.text, ...edits } }));
      return { ok: true, message: at ? `Approved. It posts ${shortWhen(at)}.` : "Approved." };
    },
    deny: async (id) => {
      update(id, { status: "denied" });
      return OK;
    },
    undoDeny: async (id) => {
      update(id, { status: "draft" });
      return OK;
    },
    save: async (id, edits) => {
      update(id, (p) => ({ text: { ...p.text, ...edits } }));
      return { ok: true, message: "Saved." };
    },
  };

  function runPosting() {
    setRunning(true);
    timers.current.push(
      window.setTimeout(() => {
        const at = new Date().toISOString();
        setPosts((all) => all.map((p) => (p.status === "scheduled" ? { ...p, status: "posted", sent: [...PLATFORMS], postedAt: at, error: null, attempts: p.attempts + 1 } : p)));
        setLastRunAt(at);
        setRunning(false);
      }, 900)
    );
  }

  function tryAgain(id: string) {
    update(id, { status: "scheduled", error: null, at: suggestSlot(CADENCE, bookings(posts, id), now)?.toISOString() ?? null });
  }

  const drafts = posts.filter((p) => p.status === "draft");
  const written = posts.filter((p) => p.n > 0);
  const scheduled = posts.filter((p) => p.status === "scheduled").sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const posted = posts.filter((p) => p.status === "posted");
  const failed = posts.filter((p) => p.status === "failed");
  const denied = posts.filter((p) => p.status === "denied");

  const queue: QueueItem[] = drafts.map((p) => ({
    id: p.id,
    hook: p.text.hook,
    body: p.text.body,
    cta: p.text.cta,
    hashtags: p.text.hashtags,
    caption: "",
    platforms: PLATFORMS,
    suggestedFor: p.at,
    source: p.source,
    imageUrl: pictureOf(p),
    photoHint: null,
  }));

  const lastPosted = posted.map((p) => p.postedAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const health = describeHealth(
    {
      migrationApplied: true,
      connection: { facebook: true, instagram: true, webhook: false },
      lastPostedAt: lastPosted,
      lastPostedChannel: lastPosted ? "Facebook + Instagram" : null,
      nextAt: scheduled[0]?.at ?? null,
      scheduledCount: scheduled.length,
      approvedWaiting: 0,
      drafts: drafts.length,
      failed: failed.map((p) => ({ error: p.error, at: p.at })),
      retrying: [],
      overdue: 0,
      lastRunAt,
      now,
    },
    (iso) => shortWhen(iso)
  );

  const upcoming: UpcomingPost[] = [...failed, ...scheduled, ...[...posted].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))].map((p) => ({
    id: p.id,
    status: p.status,
    scheduledFor: p.status === "posted" ? p.postedAt : p.at,
    platforms: PLATFORMS,
    hook: p.text.hook,
    lastError: p.error,
    attempts: p.status === "posted" ? 0 : p.attempts,
    sent: p.status === "scheduled" ? undefined : p.sent,
  }));

  // The cadence's slots, this week and next, with what is on each.
  const weeks = useMemo(() => {
    const thisWeek = localWeekKey(now);
    const slots = slotTimes(CADENCE, new Date(now.getTime() - 8 * 86_400_000), 3).filter((s) => s.rank < CADENCE.perWeek.facebook);
    const keys = [...new Set(slots.map((s) => localWeekKey(s.at)))].filter((k) => k >= thisWeek).slice(0, 2);
    return keys.map((key) => ({ key, label: key === thisWeek ? "This week" : "Next week", slots: slots.filter((s) => localWeekKey(s.at) === key).map((s) => s.at) }));
  }, [now]);

  const counts = {
    crew: posts.some((p) => p.jobNumber === JOB.number) ? "Job #418 finished" : "Job #418 in progress",
    backlog: `${written.filter((p) => p.source === "Uploaded").length} uploaded`,
    draft: written.filter((p) => p.status === "writing").length,
    ready: drafts.length,
    scheduled: scheduled.length,
    posted: posted.length,
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 pb-24">
      <header className="px-4 pt-6">
        <h1 className="text-2xl font-extrabold leading-tight">Photos into posts: the whole system</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sample data. Tap through it: nothing here is saved or posted.</p>
      </header>

      {/* ------------------------------------------------------------- flow */}
      <nav id="pp-flow" aria-label="The flow" className="px-4">
        <div className="grid grid-cols-2 gap-2">
          <FlowBox href="#pp-crew" icon={<Camera className="h-4 w-4" />} title="Crew photos" note={counts.crew} />
          <FlowBox href="#pp-upload" icon={<Upload className="h-4 w-4" />} title="Photo backlog" note={counts.backlog} />
        </div>
        <FlowArrow />
        <FlowBox href="#pp-drafting" icon={<Sparkles className="h-4 w-4" />} title="Draft" note={counts.draft ? `${counts.draft} being written` : `${written.length} written`} />
        <FlowArrow />
        <FlowBox href="#pp-queue" icon={<CheckCircle2 className="h-4 w-4" />} title="Ready to approve" note={`${counts.ready} waiting`} strong={counts.ready > 0} />
        <FlowArrow />
        <FlowBox href="#pp-calendar" icon={<CalendarDays className="h-4 w-4" />} title="Scheduled" note={`${counts.scheduled} on the calendar`} />
        <FlowArrow />
        <FlowBox href="#pp-posted" icon={<ArrowRight className="h-4 w-4" />} title="Posted on Facebook & Instagram" note={`${counts.posted} posted${failed.length ? `, ${failed.length} failed` : ""}`} />
      </nav>

      {/* ------------------------------------------------------------- 1 */}
      <Step id="pp-crew" n={1} title="Crew finishes a job" line={`Job #${JOB.number}, ${JOB.town}: take the last after photo, then Finish job.`}>
        <div className="mx-auto max-w-md px-4">
          <CompletionPanel
            key={crewKey}
            jobId="sample-job"
            status="in_progress"
            photos={crewPhotos(nowIso)}
            zones={ZONES.map(({ id, name }) => ({ id, name }))}
            allowDuring
            allowAfter
            allowSignOff
            signOffLockReason={null}
            lockedStageReason={null}
            completedAt={null}
            completedByName={null}
            completionNotes={null}
            demo={{
              photo: (kind, zone) => samplePhoto(ZONES.find((z) => z.id === zone?.id)?.sample ?? ZONES[0].sample, kind),
              onComplete: finishJob,
              completeLabel: "Finish job",
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setCrewKey((k) => k + 1)}>
              Reset the crew screen
            </button>
            {posts.some((p) => p.jobNumber === JOB.number) && (
              <a href="#pp-drafting" className="text-sm font-semibold text-[#0f766e] underline">
                See the post it made ↓
              </a>
            )}
          </div>
        </div>
      </Step>

      {/* ------------------------------------------------------------- 2 */}
      <Step id="pp-backlog" n={2} title="Or: you drop photos in the Photo backlog" line="Pick photos from your phone. Each one becomes a post.">
        <PhotoBacklog
          mode="preview"
          bookingUrl={bookingUrl}
          phone={DEFAULT_PHONE}
          idPrefix="pp-"
          onPreviewSend={(photos) =>
            addDrafts(photos.map((p) => ({ source: "Uploaded", shape: "upload" as const, sample: null, photoUrl: p.url, jobNumber: null, town: p.town, service: p.service, note: p.note })))
          }
        />
      </Step>

      {/* ------------------------------------------------------------- 3 */}
      <Step id="pp-drafting" n={3} title="Claude writes the post" line="Picture, caption, hashtags, accounts and a time, for every photo.">
        <ol className="flex flex-col gap-4 px-4">
          {written.map((p) => (
            <DraftPreview key={p.id} post={p} />
          ))}
        </ol>
      </Step>

      {/* ------------------------------------------------------------- 4 */}
      <Step id="pp-queue" n={4} title="Ready to approve" line="Fix the words if you like. Approve, or Deny.">
        <ReadyToApprove items={queue} publishesTo={["Facebook", "Instagram"]} actions={actions} idPrefix="pp-" numberOf={(item) => posts.find((p) => p.id === item.id)?.n ?? 0} />
        {denied.length > 0 && (
          <div id="pp-denied" className="mx-auto max-w-3xl px-4">
            <h3 className="font-semibold">Denied ({denied.length})</h3>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {denied.map((p) => (
                <li key={p.id} className="flex items-center gap-3 p-2">
                  <img src={pictureOf(p)} alt="" className="h-14 w-11 shrink-0 rounded object-cover opacity-60" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium line-through">{p.text.hook}</p>
                    <p className="text-xs text-muted-foreground">{p.source} · won&apos;t be posted</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => actions.undoDeny(p.id)}>
                    <Undo2 className="h-4 w-4" /> Undo
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Step>

      {/* ------------------------------------------------------------- 5 */}
      <Step id="pp-calendar" n={5} title="Scheduled week" line="Approved posts take the next free slot, on Facebook and Instagram.">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4">
          {weeks.map((week) => (
            <div key={week.key}>
              <h3 className="font-semibold">{week.label}</h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {week.slots.map((at) => {
                  const iso = at.toISOString();
                  const on = posts.find((p) => p.at === iso && (p.status === "scheduled" || p.status === "posted" || p.status === "failed"));
                  const suggested = !on ? posts.find((p) => p.at === iso && p.status === "draft") : undefined;
                  return (
                    <li key={iso} data-slot={iso} className={`flex items-center gap-3 p-2 ${on?.status === "scheduled" ? "bg-emerald-50/70 dark:bg-emerald-950/30" : ""}`}>
                      <div className="w-12 shrink-0 text-sm">
                        <p className="font-semibold">{at.toLocaleDateString("en-US", { weekday: "short", timeZone: BUSINESS_TIME_ZONE })}</p>
                        <p className="text-xs text-muted-foreground">{at.toLocaleTimeString("en-US", { hour: "numeric", timeZone: BUSINESS_TIME_ZONE })}</p>
                      </div>
                      {on ? (
                        <>
                          <img src={pictureOf(on)} alt="" className="h-14 w-11 shrink-0 rounded object-cover" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{on.text.hook}</p>
                            <p className="truncate text-xs text-muted-foreground">Facebook + Instagram</p>
                          </div>
                          <Badge className="shrink-0" variant={on.status === "scheduled" ? "default" : on.status === "failed" ? "destructive" : "secondary"}>
                            {on.status === "scheduled" ? "Scheduled" : on.status === "failed" ? "Failed" : "Posted"}
                          </Badge>
                        </>
                      ) : suggested ? (
                        <p className="flex-1 text-sm text-muted-foreground">Held for a draft waiting for approval</p>
                      ) : (
                        <p className="flex-1 text-sm text-muted-foreground">{at.getTime() < now.getTime() ? "Nothing went out" : "Free"}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div id="pp-cadence" className="rounded-lg border border-border p-4">
            <h3 className="mb-2 font-semibold">How often</h3>
            <CadenceSummary cadence={CADENCE} />
          </div>
        </div>
      </Step>

      {/* ------------------------------------------------------------- 6 */}
      <Step id="pp-posted" n={6} title="Posted" line="Each account's result, and anything that failed with why.">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4">
          <PostingHealthCard id="pp-status" health={health} />
          <Button id="pp-run" size="lg" className="w-full sm:w-auto" disabled={running || scheduled.length === 0} onClick={runPosting}>
            {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />} Run posting now
            {scheduled.length > 0 ? ` (${scheduled.length} scheduled)` : ""}
          </Button>
          <div className="space-y-2">
            <h3 className="font-semibold">Queue</h3>
            <UpcomingList
              posts={upcoming}
              actions={(p) =>
                p.status === "failed" ? (
                  <Button size="sm" variant="outline" onClick={() => tryAgain(p.id)}>
                    Try again
                  </Button>
                ) : p.status === "scheduled" ? (
                  <Button size="sm" variant="destructive" onClick={() => update(p.id, { status: "denied" })}>
                    <Ban className="size-4" /> Deny
                  </Button>
                ) : null
              }
            />
          </div>
        </div>
      </Step>
    </div>
  );
}

function FlowBox({ href, icon, title, note, strong = false }: { href: string; icon: React.ReactNode; title: string; note: string; strong?: boolean }) {
  return (
    <a
      href={href}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-accent/50 ${strong ? "border-[#0f766e] bg-[#0f766e]/10" : "border-border bg-card"}`}
    >
      <span className="text-[#0f766e]">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        <span className="block text-xs text-muted-foreground">{note}</span>
      </span>
    </a>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center py-0.5 text-muted-foreground" aria-hidden>
      <ArrowDown className="h-4 w-4" />
    </div>
  );
}

const STATUS_CHIP: Record<Status, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  writing: { label: "Writing…", variant: "outline" },
  draft: { label: "Ready to approve", variant: "default" },
  scheduled: { label: "Scheduled", variant: "secondary" },
  posted: { label: "Posted", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
  denied: { label: "Denied", variant: "destructive" },
};

/** One draft as it is written: the picture and every part of the post. */
function DraftPreview({ post }: { post: Post }) {
  const chip = STATUS_CHIP[post.status];
  const writing = post.status === "writing";
  return (
    <li id={`pp-drafting-${post.n}`} className="grid grid-cols-[112px_1fr] gap-3 rounded-xl border border-border bg-card/70 p-3 sm:grid-cols-[180px_1fr]">
      {writing && post.sample ? (
        <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg border bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <img src={pictureOf(post)} alt={`Picture for: ${post.text.hook}`} className="aspect-[4/5] w-full rounded-lg border object-cover" />
      )}
      <div className="flex min-w-0 flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{post.source}</Badge>
          <Badge variant={chip.variant}>{chip.label}</Badge>
        </div>
        {writing ? (
          <div className="flex flex-col gap-1.5 pt-1" aria-label="Writing the post">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <>
            <p className="font-bold leading-snug">{post.text.hook}</p>
            <p className="line-clamp-4 text-muted-foreground sm:line-clamp-none">{post.text.body}</p>
            <p className="text-xs text-muted-foreground">{post.text.cta}</p>
            <p className="text-xs font-medium text-[#0f766e]">{cleanHashtags(post.text.hashtags).join(" ")}</p>
            <p className="text-xs text-muted-foreground">
              {PLATFORMS.map((p) => PLATFORM_LABEL[p]).join(" + ")} · {post.at ? `${post.status === "draft" ? "Suggested " : ""}${shortWhen(post.at)}` : "Next free slot"}
            </p>
          </>
        )}
      </div>
    </li>
  );
}
