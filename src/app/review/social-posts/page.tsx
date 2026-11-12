/* eslint-disable @next/next/no-img-element -- short-lived signed photo URLs, not optimisable */
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { reviewScope } from "@/lib/data/review-scope";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { loadPostingStatus } from "@/lib/data/social-autopost";
import { publishTargets } from "@/lib/social/facebook";
import { PostingHealthCard } from "@/components/marketing/social-autopost-status";
import { SEED_DRAFTS, SEED_TOPIC_LABEL, seedCta, seedSlot } from "@/lib/social/seed-drafts";
import { composePlanCaption, cleanHashtags, planProblems } from "@/lib/social-plan";
import { DEFAULT_SOCIAL_CADENCE, PLATFORM_LABEL, slotLabel, SOCIAL_PLATFORMS, upcomingSlotsFor } from "@/lib/social/cadence";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { shortWhen } from "@/lib/time-zone";
import { outboundBaseUrl } from "@/lib/base-url";

/**
 * Social posts, for reviewing on a preview without signing in: whether
 * automatic posting works and why not, the cadence, and the twelve starter
 * drafts for the next three weeks. JS Landscaping's real data, read only.
 * Nothing on this page publishes or writes anything.
 */
export const dynamic = "force-dynamic";

async function loadLive() {
  const scope = await reviewScope();
  const targets = await publishTargets(scope.organizationId).catch(() => ({ facebook: false, instagram: false }));
  const status = await loadPostingStatus(scope, targets);

  // The suggested photos, by reference: signed for an hour, for looking at here.
  const sb = scope.client as SupabaseClient;
  const ids = SEED_DRAFTS.map((d) => d.photo?.afterPhotoId).filter((x): x is string => Boolean(x));
  const { data: photos } = await sb.from("job_photos").select("id, path").in("id", ids);
  const paths = ((photos ?? []) as { id: string; path: string }[]).filter((p) => p.path);
  const { data: signed } = paths.length ? await sb.storage.from("job-photos").createSignedUrls(paths.map((p) => p.path), 3600) : { data: [] };
  const urlByPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));
  const photoUrl = new Map<string, string | null>(paths.map((p) => [p.id, urlByPath.get(p.path) ?? null]));
  return { targets, status, photoUrl };
}

export default async function ReviewSocialPostsPage() {
  if (!reviewPagesEnabled()) notFound();
  const link = `${(await outboundBaseUrl()).replace(/\/$/, "")}/book`;
  const live = isSupabaseAdminConfigured ? await loadLive().catch((err) => {
        console.error("review social-posts:", err);
        return null;
      }) : null;
  const targets = live?.targets ?? { facebook: false, instagram: false };
  const status = live?.status ?? null;
  const cadence = status?.cadence.cadence ?? DEFAULT_SOCIAL_CADENCE;
  const photoUrl = live?.photoUrl ?? new Map<string, string | null>();

  const now = new Date();
  const a = "font-semibold text-[#2f6d3c] underline";

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-8 text-sm">
      <header>
        <h1 className="text-2xl font-extrabold">Social posts</h1>
        <p className="mt-1 text-stone-600">
          Real data, read only. Preview only: this page does not exist on the live site, and nothing here posts anything.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-bold">1. Is automatic posting working?</h2>
        <div className="mt-3">
          {status ? (
            <PostingHealthCard id="sp-status" health={status.health} />
          ) : (
            <section id="sp-status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
              The live status can&apos;t be read on this deployment (no database connection). On the preview it shows the real queue.
            </section>
          )}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-stone-700">
          <li>Facebook page connected for posting: {targets.facebook ? "yes" : "no"}.</li>
          <li>Instagram linked to that page: {targets.instagram ? "yes" : "no"}.</li>
          <li>
            Posts in the queue: {status ? `${status.upcoming.filter((p) => p.status === "scheduled").length} scheduled, ${status.input.approvedWaiting} waiting for a slot, ${status.input.failed.length} failed, ${status.input.drafts} drafts.` : "unknown here."}
          </li>
          <li>
            Fix: Admin › <a className={a} href="/admin/meta">Facebook &amp; Instagram</a> › Setup: paste the Meta App ID and secret, press Connect Facebook, allow every
            permission (including instagram_content_publish), then on the Pages tab tick Posting on the business page.
          </li>
        </ul>
      </section>

      <section id="sp-cadence">
        <h2 className="text-lg font-bold">2. How often</h2>
        <p className="mt-1 text-stone-600">
          {status?.cadence.ready ? "As saved in Admin › Social." : "The defaults (migration 0374 isn't applied yet, so nothing is saved)."} Approved posts take the next free
          slot by themselves; a post never goes out without approval.
        </p>
        <table className="mt-3 w-full max-w-xl text-left">
          <thead className="text-stone-500">
            <tr>
              <th className="py-1 font-medium">Account</th>
              <th className="py-1 font-medium">A week</th>
              <th className="py-1 font-medium">Times (Eastern)</th>
              <th className="py-1 font-medium">Next four</th>
            </tr>
          </thead>
          <tbody>
            {SOCIAL_PLATFORMS.map((p) => (
              <tr key={p} className="border-t border-stone-200 align-top">
                <td className="py-1">{PLATFORM_LABEL[p]}</td>
                <td className="py-1">{cadence.perWeek[p]}</td>
                <td className="py-1">{cadence.slots.slice(0, cadence.perWeek[p]).map(slotLabel).join(", ")}</td>
                <td className="py-1">{upcomingSlotsFor(cadence, p, now, 4).map((d) => shortWhen(d)).join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section id="sp-drafts">
        <h2 className="text-lg font-bold">3. Twelve drafts for the next three weeks</h2>
        <p className="mt-1 text-stone-600">
          Ready to approve. Load them from Admin › Social (Load the starter posts), edit anything in the week plan, and approve: each goes out on its slot to Facebook
          and Instagram.
        </p>
        <ol className="mt-4 grid gap-4 sm:grid-cols-2">
          {SEED_DRAFTS.map((d, i) => {
            const caption = composePlanCaption({ hook: d.hook, body: d.body, cta: seedCta(d, link), hashtags: d.hashtags }, null);
            const problems = planProblems({ hook: d.hook, body: d.body, cta: d.cta, hashtags: d.hashtags });
            const url = d.photo ? photoUrl.get(d.photo.afterPhotoId) : null;
            return (
              <li key={d.key} id={`sp-draft-${i + 1}`} className="flex flex-col overflow-hidden rounded-lg border border-stone-200">
                {url ? (
                  <img src={url} alt={`After photo, ${d.photo?.town}`} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-[#0f766e] p-6 text-center text-lg font-extrabold text-white">{d.hook}</div>
                )}
                <div className="space-y-2 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {i + 1}. {SEED_TOPIC_LABEL[d.topic]} · {shortWhen(seedSlot(d))} · {d.platforms.map((p) => PLATFORM_LABEL[p]).join(" + ")}
                  </p>
                  <p className="whitespace-pre-line">{caption}</p>
                  <p className="text-xs text-stone-500">Hashtags: {cleanHashtags(d.hashtags).join(" ")}</p>
                  <p className="text-xs text-stone-500">Photo: {d.photoHint}</p>
                  {problems.length > 0 && <p className="text-xs text-red-700">{problems.join(" ")}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
