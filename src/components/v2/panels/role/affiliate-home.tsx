import { after } from "next/server";

import { CommentCard } from "@/components/marketing/comment-card";
import { RecentAnswers } from "@/components/marketing/recent-answers";
import { AffiliateLinkCard } from "@/components/v2/panels/role/affiliate-link-card";
import { affiliateMoney, affiliateResults, privateBoard } from "@/lib/affiliate-home";
import { outboundBaseUrl } from "@/lib/base-url";
import type { BroughtInRow } from "@/lib/brought-in";
import { getBroughtIn, myBookingLink } from "@/lib/data/brought-in";
import { getCommissionFor } from "@/lib/data/commission";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { answeredToday, getPostBoard } from "@/lib/data/post-board";
import { sweepPosts } from "@/lib/data/post-sweep";
import { getCurrentProfile } from "@/lib/data/team";
import { qrSvg } from "@/lib/qr";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * The affiliate's home screen in the new layout: their whole day on one
 * phone screen, top to bottom in the order they do it.
 *
 * 1. Posts to answer: the next neighbor asking for yard work, with a reply
 *    written for them carrying their own tracked link. "Copy & go to post"
 *    copies it, opens the post and marks it posted.
 * 2. Their booking link: copy, share, or a QR code to scan.
 * 3. What came of it: clicks, bookings, and each project they brought in.
 * 4. Their money: earned, paid, and still owed.
 *
 * Drawn as getCurrentProfile(), so Preview as shows exactly this person.
 * Everything here is theirs alone: other people on a post show as a first
 * name only, and no company or other affiliate's numbers are read.
 */
export async function AffiliateHomePanel() {
  const profile = await getCurrentProfile();
  if (!profile) return <Card>Sign in again to see your day.</Card>;
  const org = profile.organization_id;
  const now = new Date();
  const baseUrl = await outboundBaseUrl().catch(() => "");

  const [posts, today, projects, clickCounts, link, commission] = await Promise.all([
    getCurrentOrganization()
      .then((o) => getPostBoard(org, profile.id, now, { roles: profile.roles, businessName: o.name }))
      .catch((err) => {
        console.error("Affiliate home: posts failed to load:", err);
        return null;
      }),
    answeredToday(org, profile.id, now).catch(() => 0),
    getBroughtIn(profile.id).catch(() => null),
    myClicks(org, profile.id),
    myBookingLink(profile, baseUrl).catch(() => null),
    getCommissionFor(profile).catch((err) => {
      console.error("Affiliate home: commission failed to load:", err);
      return null;
    }),
  ]);
  const qr = link ? await qrSvg(link, 256).catch(() => null) : null;
  // As Posts to Answer does: anything the finder brought in that is not
  // sorted or written yet is, after this page is sent, so it is here next look.
  after(() => sweepPosts(org).then(() => undefined));

  const board = posts ? privateBoard(posts) : null;
  const results = affiliateResults(clickCounts, projects ?? []);
  const pay = affiliateMoney(commission);

  return (
    <div className="mx-auto grid w-full max-w-md gap-5">
      <section data-tour="affiliate-posts" aria-labelledby="aff-posts">
        <Heading id="aff-posts" step={1} title="Answer a post" sub="Neighbors asking for yard work. Use the reply, copy it, paste it under their post." />
        {board ? (
          <div className="grid gap-4">
            <CommentCard posts={board} pinned={null} answeredToday={today} />
            <RecentAnswers posts={board} />
          </div>
        ) : (
          <Card>The posts couldn&apos;t load just now. Reload the page.</Card>
        )}
      </section>

      <section data-tour="affiliate-link" aria-labelledby="aff-link">
        <Heading id="aff-link" step={2} title="Share your link" sub="Your own booking link. Anyone who books through it is yours." />
        <Card>
          <AffiliateLinkCard link={link} qrSvg={qr} />
        </Card>
      </section>

      <section data-tour="affiliate-results" aria-labelledby="aff-results">
        <Heading id="aff-results" step={3} title="What came of it" sub="Your links and your bookings only." />
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Clicks" value={String(results.clicks)} />
          <Stat label="Booked" value={projects ? String(results.booked) : "—"} />
          <Stat label="Sold" value={projects ? String(results.sold) : "—"} />
        </div>
        <div className="mt-3">
          {projects == null ? (
            <Card>Your projects couldn&apos;t load just now. Reload the page.</Card>
          ) : projects.length === 0 ? (
            <Card>No bookings yet. Every one that comes through your replies or your link shows up here.</Card>
          ) : (
            <ul className="grid gap-2">
              {projects.map((p) => (
                <ProjectRow key={p.jobId} row={p} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section data-tour="affiliate-money" aria-labelledby="aff-money">
        <Heading id="aff-money" step={4} title="Your money" sub="You earn 4% of what each project you brought in is paid." />
        {commission ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Earned" value={money(pay.earned)} strong />
              <Stat label="Paid to you" value={money(pay.paid)} />
              <Stat label="Still owed" value={money(pay.owed)} alert={pay.owed > 0} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Earned once the client pays. Still owed is paid out to you by the office.
            </p>
          </>
        ) : (
          <Card>Your earnings couldn&apos;t load just now. Reload the page.</Card>
        )}
      </section>
    </div>
  );
}

/** Opens of every link this person put out. Their own rows only. */
async function myClicks(organizationId: string, profileId: string): Promise<number[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("outreach_links")
      .select("click_count")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .limit(5000);
    if (error) return [];
    return (data ?? []).map((r) => r.click_count ?? 0);
  } catch {
    return [];
  }
}

function Heading({ id, step, title, sub }: { id: string; step: number; title: string; sub: string }) {
  return (
    <div className="mb-2 flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {step}
      </span>
      <div>
        <h2 id={id} className="text-lg font-extrabold leading-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-card p-4 text-sm">{children}</div>;
}

function Stat({ label, value, strong, alert }: { label: string; value: string; strong?: boolean; alert?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", alert && "border-amber-400/70 bg-amber-50/60 dark:bg-amber-500/10")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums", strong ? "text-xl font-extrabold" : "text-lg font-bold")}>{value}</p>
    </div>
  );
}

function ProjectRow({ row }: { row: BroughtInRow }) {
  const won = row.step === "sold" || row.step === "done";
  return (
    <li className={cn("rounded-xl border bg-card p-3 text-sm", won && "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/10", row.step === "lost" && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{row.client}</span>
        {row.yours != null && <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">Your 4%: {money(row.yours)}</span>}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{row.label}</p>
    </li>
  );
}
