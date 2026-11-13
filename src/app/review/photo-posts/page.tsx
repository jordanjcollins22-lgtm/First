/* eslint-disable @next/next/no-img-element -- the app's own drawn post pictures */
import { notFound } from "next/navigation";

import { reviewScope } from "@/lib/data/review-scope";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { outboundBaseUrl } from "@/lib/base-url";
import { shortWhen } from "@/lib/time-zone";
import { PLATFORM_LABEL, type SocialPlatform } from "@/lib/social/cadence";
import { DEFAULT_PHONE, draftCaption, draftProblems, draftText } from "@/lib/social/photo-drafts";
import { backlogCounts, listJobDraftCandidates, listReadyToApprove, type JobCandidate, type QueueItem } from "@/lib/data/social-photo-drafts";
import { PhotoBacklog } from "@/components/marketing/photo-backlog";
import { ReviewDecisionCount, ReviewDecisions, ReviewDraftCard } from "@/components/marketing/social-review-decisions";

/**
 * Photo to post drafts, for reviewing on a preview without signing in:
 * the photo backlog uploader (works here in the browser, saves nothing),
 * the "Ready to approve" queue from JS Landscaping's real data (or a
 * sample when there is none to read), and where drafts come from. Read
 * only: nothing on this page writes, uploads or posts anything.
 */
export const dynamic = "force-dynamic";

function sampleQueue(bookingUrl: string, now: Date): QueueItem[] {
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const make = (id: string, source: string, shape: "pair" | "single" | "upload", town: string, service: string, days: number): QueueItem => {
    const t = draftText({ shape, town, service, phone: DEFAULT_PHONE, bookingUrl });
    return { id, ...t, caption: draftCaption(t), platforms: ["facebook", "instagram"], suggestedFor: at(days), source, imageUrl: "", photoHint: null };
  };
  return [
    make("sample-1", "From job #412", "pair", "Bel Air", "Mulching", 2),
    make("sample-2", "From job #415", "single", "Fallston", "Fall cleanup", 4),
    make("sample-3", "Uploaded", "upload", "Abingdon", "Bed edging", 6),
  ];
}

async function loadLive() {
  const scope = await reviewScope();
  const [queue, candidates, counts] = await Promise.all([
    listReadyToApprove(scope.client, scope.organizationId),
    listJobDraftCandidates(scope.client, scope.organizationId).catch(() => [] as JobCandidate[]),
    backlogCounts(scope.client, scope.organizationId).catch(() => null),
  ]);
  return { queue, candidates, counts };
}

export default async function ReviewPhotoPostsPage() {
  if (!reviewPagesEnabled()) notFound();
  const now = new Date();
  const bookingUrl = `${(await outboundBaseUrl()).replace(/\/$/, "")}/book`;
  const live = isSupabaseAdminConfigured
    ? await loadLive().catch((err) => {
        console.error("review photo-posts:", err);
        return null;
      })
    : null;
  const real = Boolean(live && live.queue.length > 0);
  const queue = real ? live!.queue : sampleQueue(bookingUrl, now);
  const candidates = live?.candidates ?? [];
  const bySource = new Map<string, number>();
  for (const q of live?.queue ?? []) {
    const key = q.source.startsWith("From job") ? "From a finished job" : q.source;
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-8 text-sm">
      <header>
        <h1 className="text-2xl font-extrabold">Photos into posts</h1>
        <p className="mt-1 text-stone-600">
          Preview only: this page does not exist on the live site, and nothing here saves, uploads or posts anything. On the live app it&apos;s Admin › Social: &quot;Ready to
          approve&quot; at the top, &quot;Photo backlog&quot; under it.
        </p>
      </header>

      <section id="pp-sources">
        <h2 className="text-lg font-bold">1. Where the drafts come from</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-stone-700">
          <li>
            <b>Uploaded:</b> photos added to the Photo backlog on Admin › Social. Each one becomes a draft the moment it is uploaded.
          </li>
          <li>
            <b>From job #N:</b> when the crew finishes a job (Complete job, the sub-crew&apos;s I&apos;m finished, or the manager approving the photos or signing it off), its
            before and after become a draft (or its best after photo alone when there is no pair). The hourly posting run also catches up any finished job from the last
            three weeks that has no post yet. One post per job, never two.
          </li>
          <li>Captions: the AI writer on the live site, the template here and whenever the writer can&apos;t be reached. Town only: no street, no client, no prices.</li>
          <li>Every draft waits for Approve or Deny. Approve gives it its suggested time (or the next free slot) and it posts to Facebook and Instagram then.</li>
        </ol>
        {live ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-stone-700">
            <li>
              Waiting now: {live.queue.length} draft{live.queue.length === 1 ? "" : "s"}
              {bySource.size ? ` (${[...bySource].map(([k, n]) => `${k}: ${n}`).join(", ")})` : ""}.
            </li>
            <li>
              Photo backlog: {live.counts ? `${live.counts.total} uploaded, ${live.counts.drafted} turned into posts.` : "migration 0376_social_photo_backlog.sql isn't applied yet, so uploads can't be saved."}
            </li>
            <li>
              Finished jobs from the last three weeks with no post yet: {candidates.length}.{" "}
              {candidates.length > 0 &&
                candidates
                  .slice(0, 8)
                  .map((c) => `#${c.jobNumber ?? "?"}${c.town ? ` (${c.town})` : ""}: ${c.shape === "pair" ? "before and after" : c.shape === "single" ? "after photo alone" : "no after photo yet"}`)
                  .join("; ")}
            </li>
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">The real queue can&apos;t be read on this deployment, so a sample is shown below.</p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold">2. Photo backlog</h2>
        <p className="mt-1 text-stone-600">Pick a photo (or several): the draft it would make shows under it, with its caption. Nothing is uploaded from this page.</p>
        <div className="-mx-4 mt-3">
          <PhotoBacklog mode="preview" phone={DEFAULT_PHONE} bookingUrl={bookingUrl} idPrefix="pp-" />
        </div>
      </section>

      <ReviewDecisions total={queue.length}>
        <section id="pp-queue">
          <h2 className="text-lg font-bold">3. Ready to approve ({queue.length})</h2>
          <p className="mt-1 text-stone-600">{real ? "The real drafts waiting for approval, read only." : "A sample: there are no real drafts to read here yet."}</p>
          <ReviewDecisionCount prefix="pp" where={'in "Ready to approve" at the top of the page'} />
          <ol className="mt-4 grid gap-4 sm:grid-cols-2">
            {queue.map((q, i) => {
              const problems = draftProblems(q);
              return (
                <ReviewDraftCard key={q.id} n={i + 1} prefix="pp">
                  {q.imageUrl ? (
                    <img src={q.imageUrl} alt={`Picture for: ${q.hook}`} className="aspect-square w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-[#0f766e] p-6 text-center text-lg font-extrabold text-white">{q.hook}</div>
                  )}
                  <div className="space-y-2 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                      {q.source} · {q.suggestedFor ? shortWhen(q.suggestedFor) : "next free slot"} ·{" "}
                      {q.platforms.map((p) => PLATFORM_LABEL[p as SocialPlatform] ?? p).join(" + ")}
                    </p>
                    <p className="whitespace-pre-line">{q.caption}</p>
                    {q.photoHint && <p className="text-xs text-stone-500">Photo: {q.photoHint}</p>}
                    {problems.length > 0 && <p className="text-xs text-red-700">{problems.join(" ")}</p>}
                  </div>
                </ReviewDraftCard>
              );
            })}
          </ol>
        </section>
      </ReviewDecisions>
    </main>
  );
}
