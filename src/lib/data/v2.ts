import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { attributionReport } from "@/lib/data/attribution";
import { loadWebsiteForEditor, type WebsiteState } from "@/lib/data/website";
import { CHANNEL_LABEL } from "@/lib/attribution";

/**
 * The live numbers behind the new four-page layout at /v2.
 *
 * Everything here only reads. The new layout is being built beside the app
 * the business runs on, against the same database, and until a tab is
 * finished it must not be able to change anything the running app relies on.
 * Each loader asks for small columns or counts only; the big map tables
 * (houses, road segments, mail segments) are counted, never pulled.
 *
 * A table a viewer cannot read, or one that has gone away, shows as a dash
 * rather than taking the whole page down with it.
 */

export type V2Role = "owner" | "affiliate" | "evaluator" | "project-lead" | "project-technician" | "account-manager";
export type V2Kind = "" | "auto" | "people" | "project" | "admin";

export interface V2Block {
  t: string;
  v: string;
  d: string;
  rows?: string[];
}

export interface V2Pillar {
  id: string;
  label: string;
  kind: V2Kind;
  who: V2Role[];
  /** Which half of the overview it is listed under. */
  group?: "a" | "b";
  blurb?: string;
  title: string;
  sub: string;
  blocks: V2Block[];
  links: { label: string; href: string }[];
  /** A pillar with a screen of its own rather than blocks of numbers. */
  view?: "website";
}

export interface V2Section {
  key: "marketing" | "sales" | "operations" | "admin";
  name: string;
  roles: { key: V2Role; label: string }[];
  groups: { a: { title: string; note: string }; b: { title: string; note: string } };
  pillars: V2Pillar[];
  loadedAt: string;
  /** Marketing only: the website editor's content. */
  website?: WebsiteState;
}

type Row = Record<string, unknown>;
// The loaders range over dozens of tables by name; the generated types would
// need a branch per table for no gain in a read-only summary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

const TZ = "America/New_York";

async function db(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

async function count(sb: SupabaseClient, table: string, filter?: (q: Q) => Q): Promise<number | null> {
  try {
    let q: Q = sb.from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: n, error } = await q;
    return error ? null : (n ?? 0);
  } catch {
    return null;
  }
}

async function rows(sb: SupabaseClient, table: string, cols: string, filter?: (q: Q) => Q): Promise<Row[]> {
  try {
    let q: Q = sb.from(table).select(cols);
    if (filter) q = filter(q);
    const { data, error } = await q;
    return error ? [] : ((data ?? []) as Row[]);
  } catch {
    return [];
  }
}

const n = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-US"));
const usd = (x: number | null | undefined) =>
  x == null ? "—" : "$" + Math.round(x).toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) + "%" : "—");
const str = (x: unknown) => (typeof x === "string" ? x : "");
const num = (x: unknown) => (typeof x === "number" ? x : Number(x ?? 0) || 0);
const day = (iso: unknown) =>
  iso ? new Date(str(iso)).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" }) : "—";
const when = (iso: unknown) =>
  new Date(str(iso)).toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
/** "12 Haystack Court, Forest Hill, Maryland 21050, United States — Estimate" → "12 Haystack Court, Forest Hill" */
const place = (name: unknown) => {
  const parts = str(name).split(/\s+[—-]\s+|,/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 && /\d/.test(parts[0]) ? `${parts[0]}, ${parts[1]}` : parts[0] ?? "—";
};
const tally = (list: Row[], key: string) => {
  const m = new Map<string, number>();
  for (const r of list) m.set(str(r[key]) || "(none)", (m.get(str(r[key]) || "(none)") ?? 0) + 1);
  return m;
};
const since = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const stamp = () =>
  new Date().toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/* ------------------------------------------------------------------ */
/* Marketing                                                           */
/* ------------------------------------------------------------------ */

const PROSPECT_STATUSES = ["new", "queued", "contacted", "converted", "rejected"] as const;
const PLAY_LABEL: Record<string, string> = { yard_sign: "Yard signs", knocks: "Door knocks", door_hangers: "Door hangers", flyers: "Flyers" };

export async function loadMarketing(): Promise<V2Section> {
  const sb = await db();
  const [
    links, posts, profiles, referredJobs,
    newContacts, seen, answers, finder, bookVisits, booked, located, salt, mow,
    reviews, proof, rank, adClicks, plays, prospectCounts, campaigns, advances,
    mailings, flyerRuns, pmCompanies, pmSent, groups, attribution, openPlays, website,
  ] = await Promise.all([
    rows(sb, "outreach_links", "platform,kind,click_count,profile_id,created_at,posted_comment,comment"),
    rows(sb, "social_posts", "status,channel,scheduled_for,hook,caption"),
    rows(sb, "profiles", "id,full_name,email,is_affiliate,affiliate_slug,commission_pct"),
    rows(sb, "jobs", "referred_by_profile_id", (q) => q.not("referred_by_profile_id", "is", null)),
    count(sb, "customers", (q) => q.gte("created_at", since(30))),
    count(sb, "outreach_seen_posts"),
    count(sb, "outreach_post_answers"),
    count(sb, "finder_computers"),
    count(sb, "booking_visits", (q) => q.gte("created_at", since(30))),
    count(sb, "booking_visits", (q) => q.gte("created_at", since(30)).not("booked_job_id", "is", null)),
    count(sb, "booking_visits", (q) => q.eq("located_tapped", true)),
    count(sb, "salt_orders"),
    count(sb, "mow_orders"),
    count(sb, "job_client_reviews", (q) => q.eq("status", "approved")),
    count(sb, "booking_proof"),
    count(sb, "rank_keywords"),
    count(sb, "job_ad_clicks"),
    count(sb, "marketing_plays"),
    Promise.all(PROSPECT_STATUSES.map((st) => count(sb, "lead_prospects", (q) => q.eq("status", st)))),
    rows(sb, "email_campaigns", "name,status,service_label,started_at"),
    rows(sb, "commission_advances", "amount,status"),
    rows(sb, "eddm_mailings", "name,pieces,status,mailed_on", (q) => q.order("created_at", { ascending: false })),
    rows(sb, "flyer_runs", "name,mails_on,flyer_count,status", (q) => q.order("created_at", { ascending: false })),
    rows(sb, "pm_companies", "status"),
    count(sb, "pm_emails", (q) => q.eq("status", "sent")),
    rows(sb, "community_groups", "name,platform,member_count,archived_at"),
    attributionReport(365).catch(() => null),
    rows(sb, "marketing_plays", "kind", (q) => q.eq("status", "open")),
    getCurrentOrganizationId()
      .then((id) => loadWebsiteForEditor(id))
      .catch(() => null),
  ]);

  const name = (id: unknown) => {
    const p = profiles.find((x) => x.id === id);
    return p ? str(p.full_name) || str(p.email) : "Unknown";
  };
  const comments = links.filter((l) => l.kind === "comment");
  const clicks = (list: Row[]) => list.reduce((s, l) => s + num(l.click_count), 0);
  const byPlatform = (p: string) => links.filter((l) => l.platform === p);
  const postStatus = tally(posts, "status");
  const due = posts.filter((p) => p.status === "scheduled");
  const dueLate = due.filter((p) => p.scheduled_for && str(p.scheduled_for) < new Date().toISOString()).length;
  const affiliates = profiles.filter((p) => p.is_affiliate);
  const refBy = tally(referredJobs, "referred_by_profile_id");
  const advanced = advances.filter((a) => a.status === "paid").reduce((s, a) => s + num(a.amount), 0);
  const latest = [...comments].sort((a, b) => str(b.created_at).localeCompare(str(a.created_at))).slice(0, 4);
  const prospectTotal = prospectCounts.reduce<number>((a, c) => a + (c ?? 0), 0);
  const liveGroups = groups.filter((g) => !g.archived_at);
  const channels: [string, string][] = [
    ["facebook", "Facebook"], ["nextdoor", "Nextdoor"], ["instagram", "Instagram"],
    ["google", "Google Business posts"], ["tiktok", "TikTok"], ["youtube", "YouTube"],
  ];

  const pillars: V2Pillar[] = [
    {
      id: "ads", label: "Google Ads", kind: "auto", who: ["owner"], group: "a",
      blurb: adClicks ? `${n(adClicks)} ad clicks recorded` : "Not live",
      title: "Google Ads", sub: "Paid search for priority services across Harford County.",
      blocks: [
        { t: "Ad clicks recorded", v: n(adClicks), d: "Bookings already record Google and Facebook click IDs" },
        { t: "Campaigns", v: "0", d: "None live", rows: ["Aeration + overseeding", "Fall cleanup + leaf removal", "Snow removal + holiday lighting"] },
        { t: "Targeting", v: "Harford", d: "Owner-occupied, $100k+ household income" },
      ],
      links: [],
    },
    {
      id: "website", label: "Website", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(bookVisits)} visits · ${n(booked)} booked (30 days)`,
      title: "Website", sub: "Your website and every page a customer lands on. Edit it, preview it on a phone or a desktop, and publish.",
      view: "website",
      blocks: [
        { t: "Booking page", v: n(bookVisits), d: `Visits in 30 days · ${n(booked)} booked · ${pct(booked ?? 0, bookVisits ?? 0)}` },
        { t: "Salt pre-book", v: n(salt), d: "Prepaid ice melt orders" },
        { t: "Quick mow page", v: n(mow), d: "Orders" },
        { t: "Instant address booking", v: n(located), d: "Locate-me taps on the booking page" },
      ],
      links: [
        { label: "Booking page", href: "/admin/booking-page" },
        { label: "Quick mow pipeline", href: "/mow-orders" },
        { label: "Salt route", href: "/admin/salt" },
      ],
    },
    {
      id: "print", label: "Door hangers & mail", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(openPlays.length)} open plays · ${n(mailings.length)} mailings`,
      title: "Door hangers & mail", sub: "Hangers, yard signs, flyers and every-door mail around the jobs we do.",
      blocks: [
        {
          t: "Open plays", v: n(openPlays.length), d: "Set off by an evaluation or a client, waiting to go out",
          rows: [...tally(openPlays, "kind")].map(([k, c]) => `${PLAY_LABEL[k] ?? k} · ${n(c)}`),
        },
        { t: "Plays in total", v: n(plays), d: "Every hanger run, sign, knock and flyer drop on file" },
        {
          t: "EDDM mailings", v: n(mailings.length), d: `${n(mailings.reduce((a, m) => a + num(m.pieces), 0))} pieces planned or mailed`,
          rows: mailings.slice(0, 5).map((m) => `${str(m.name)} · ${n(num(m.pieces))} pieces · ${str(m.status)}${m.mailed_on ? ` · ${day(m.mailed_on)}` : ""}`),
        },
        {
          t: "Shared flyer runs", v: n(flyerRuns.length), d: "Flyers with paid ad squares from other local businesses",
          rows: flyerRuns.slice(0, 5).map((f) => `${str(f.name)} · ${n(num(f.flyer_count))} flyers · ${str(f.status)}${f.mails_on ? ` · ${day(f.mails_on)}` : ""}`),
        },
      ],
      links: [],
    },
    {
      id: "lists", label: "Lead lists", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(prospectTotal)} property owners`,
      title: "Lead lists", sub: "Property owners to reach, and where each one has got to.",
      blocks: [
        {
          t: "Prospects", v: n(prospectTotal), d: "Owners and addresses on file",
          rows: PROSPECT_STATUSES.map((st, i) => `${st[0].toUpperCase() + st.slice(1)} · ${n(prospectCounts[i])}`),
        },
      ],
      links: [],
    },
    {
      id: "email", label: "Email campaigns", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(campaigns.filter((c) => c.status === "running").length)} running`,
      title: "Email campaigns", sub: "Offers emailed to past and nearby clients, a few at a time.",
      blocks: [
        {
          t: "Campaigns", v: n(campaigns.length), d: "Draft, running, paused and done",
          rows: campaigns.map((c) => `${str(c.name)} · ${str(c.service_label)} · ${str(c.status)}${c.started_at ? ` · started ${day(c.started_at)}` : ""}`),
        },
      ],
      links: [],
    },
    {
      id: "pm", label: "Property managers", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(pmCompanies.length)} companies · ${n(pmSent)} emails sent`,
      title: "Property managers", sub: "Cold email to local property management companies, in your words, a few each weekday.",
      blocks: [
        { t: "Companies", v: n(pmCompanies.length), d: "Found and on the list", rows: [...tally(pmCompanies, "status")].map(([k, c]) => `${k.replace(/_/g, " ")} · ${n(c)}`) },
        { t: "Emails sent", v: n(pmSent), d: `${n(pmCompanies.filter((c) => c.status === "replied" || c.status === "interested").length)} replied or interested` },
      ],
      links: [],
    },
    {
      id: "groups", label: "Local groups", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(liveGroups.length)} groups`,
      title: "Local groups", sub: "The neighborhood groups we run, and the businesses that pay to post in them.",
      blocks: [
        {
          t: "Groups we run", v: n(liveGroups.length), d: "Members as last counted",
          rows: liveGroups.map((g) => `${str(g.name)} · ${str(g.platform)}${g.member_count == null ? "" : ` · ${n(num(g.member_count))} members`}`),
        },
      ],
      links: [],
    },
    {
      id: "worked", label: "What worked", kind: "auto", who: ["owner"], group: "a",
      blurb: attribution ? `${usd(attribution.totals.totalRevenueCents / 100)} traced over a year` : "Not available",
      title: "What worked", sub: "Money actually received in the last year, traced back to what brought it in.",
      blocks: attribution
        ? [
            {
              t: "By channel", v: usd(attribution.totals.totalRevenueCents / 100), d: `${n(attribution.totals.totalJobs)} paid jobs`,
              rows: attribution.totals.channels.map((c) => `${CHANNEL_LABEL[c.channel]} · ${usd(c.revenueCents / 100)} · ${n(c.jobs)} jobs${c.inferredJobs ? ` (${n(c.inferredJobs)} inferred)` : ""}`),
            },
            { t: "Couldn't be told apart", v: usd(attribution.totals.unknown.revenueCents / 100), d: `${n(attribution.totals.unknown.jobs)} jobs a campaign may have reached` },
            { t: "Nothing recorded", v: usd(attribution.totals.unattributed.revenueCents / 100), d: `${n(attribution.totals.unattributed.jobs)} jobs no campaign reached` },
            ...(attribution.health.length ? [{ t: "Read this first", v: "", d: "What the numbers can and can't support", rows: attribution.health }] : []),
          ]
        : [{ t: "Not available", v: "—", d: "The report couldn't be read for this account" }],
      links: [],
    },
    {
      id: "seo", label: "SEO", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(reviews)} reviews`,
      title: "SEO", sub: "Local search visibility and reviews.",
      blocks: [
        { t: "Client reviews approved", v: n(reviews), d: `${n(proof)} shown as proof on the booking page` },
        { t: "Keyword tracking", v: n(rank), d: rank ? "Keywords tracked" : "Rank tracker built but empty" },
      ],
      links: [],
    },
    {
      id: "social", label: "Social media", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(links.length)} links · ${n(clicks(links))} clicks`,
      title: "Social media", sub: "Every channel, posting and replying on autopilot.",
      blocks: [
        {
          t: "Channels", v: n(links.length), d: "Tracked links shared, by channel",
          rows: channels.map(([k, label]) => {
            const l = byPlatform(k);
            return `${label} · ${n(l.length)} links · ${n(clicks(l))} clicks`;
          }),
        },
        {
          t: "Post queue", v: n(posts.length), d: "Before-and-after posts",
          rows: [
            `Scheduled · ${n(postStatus.get("scheduled") ?? 0)}${dueLate ? ` (${dueLate} past date, not posted)` : ""}`,
            `Drafts · ${n(postStatus.get("draft") ?? 0)}`,
            `Posted · ${n(postStatus.get("posted") ?? 0)}`,
            `Skipped · ${n(postStatus.get("skipped") ?? 0)}`,
          ],
        },
        { t: "Local groups", v: "", d: "Facebook group rules and paid business posts" },
      ],
      links: [
        { label: "Before & after posts", href: "/admin/social" },
        { label: "Local groups", href: "/admin/groups" },
      ],
    },
    {
      id: "comments", label: "Auto comment responder", kind: "auto", who: ["owner", "affiliate"], group: "a",
      blurb: `${n(comments.length)} replies · ${n(clicks(comments))} clicks`,
      title: "Auto comment responder", sub: "Finds local posts asking for help and replies with a tracked link.",
      blocks: [
        { t: "Posts scanned", v: n(seen), d: `Post finder running on ${n(finder)} computers` },
        { t: "Replies posted", v: n(comments.length), d: `${n(clicks(comments))} link clicks · ${n(answers)} drafted answers` },
        {
          t: "Latest replies", v: n(latest.length), d: "Newest first",
          rows: latest.map(
            (l) =>
              `${day(l.created_at)} · ${name(l.profile_id)} · ${str(l.platform)} · ${n(num(l.click_count))} clicks — ${(
                str(l.posted_comment) || str(l.comment)
              ).slice(0, 90)}…`
          ),
        },
      ],
      links: [
        { label: "Link tracking", href: "/admin/outreach" },
        { label: "Posts to answer", href: "/admin/outreach/posts" },
        { label: "Where posts come from", href: "/admin/outreach/agent" },
      ],
    },
    {
      id: "affiliates", label: "Affiliates", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(affiliates.length)} affiliates · ${n(referredJobs.length)} projects referred`,
      title: "Affiliates", sub: "Lead getters who share a link and earn on every project.",
      blocks: [
        {
          t: "Roster", v: n(affiliates.length), d: "Commission rate is what each person has on file",
          rows: affiliates.map((a) => {
            const mine = links.filter((l) => l.profile_id === a.id);
            return `${str(a.full_name) || "[no name]"} · code ${str(a.affiliate_slug) || "—"} · ${n(mine.length)} links · ${n(
              clicks(mine)
            )} clicks · ${n(refBy.get(str(a.id)) ?? 0)} projects · ${a.commission_pct == null ? "rate not set" : a.commission_pct + "%"}`;
          }),
        },
        { t: "Projects referred", v: n(referredJobs.length), d: "Jobs with an affiliate attached" },
        { t: "Commission advanced", v: usd(advanced), d: "Paid out ahead of a job closing" },
      ],
      links: [{ label: "Team & services", href: "/admin/team" }],
    },
  ];

  return {
    key: "marketing",
    name: "Marketing",
    roles: [{ key: "owner", label: "Owner" }, { key: "affiliate", label: "Affiliate" }],
    groups: {
      a: { title: "Get leads", note: `${n(newContacts)} new contacts in 30 days. Every channel feeds GoHighLevel.` },
      b: { title: "Get lead getters", note: "Affiliates share a personal link and earn on every project it brings in." },
    },
    pillars: [
      overview("Marketing overview", "Two jobs: bring in leads automatically, and grow the people who bring in work.", [], [{ label: "Current marketing page", href: "/marketing" }]),
      ...pillars,
    ],
    loadedAt: stamp(),
    website: website ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export async function loadSales(): Promise<V2Section> {
  const sb = await db();
  const orgId = await getCurrentOrganizationId().catch(() => null);
  const [jobs, proposals, profiles, calls, approvals, msgs, rules, intakes, invoices, services, ghl,
    views, avail, daysOff, teamRem, bookVisits, booked] = await Promise.all([
    rows(sb, "jobs", "id,name,status,evaluation_status,evaluation_date,assigned_to,referral_code,referred_by_profile_id"),
    rows(sb, "job_proposals", "status,total_cost,job_id"),
    rows(sb, "profiles", "id,full_name,email,does_evaluations,commission_pct"),
    rows(sb, "proposal_calls", "outcome"),
    rows(sb, "outbound_approvals", "status"),
    rows(sb, "client_message_log", "kind,channel"),
    rows(sb, "reminder_rules", "kind,enabled,offsets_hours"),
    rows(sb, "evaluation_intakes", "submitted_at"),
    rows(sb, "invoices", "status,amount"),
    rows(sb, "services", "name,status,cost,cost_unit"),
    rows(sb, "ghl_sync_state", "organization_id,last_pulled_at,last_result"),
    count(sb, "proposal_views"),
    count(sb, "availability_weekly"),
    count(sb, "availability_days_off"),
    count(sb, "team_reminder_log"),
    count(sb, "booking_visits", (q) => q.gte("created_at", since(30))),
    count(sb, "booking_visits", (q) => q.gte("created_at", since(30)).not("booked_job_id", "is", null)),
  ]);

  const now = new Date().toISOString();
  const name = (id: unknown) => {
    const p = profiles.find((x) => x.id === id);
    return p ? str(p.full_name) || str(p.email) : "Unassigned";
  };
  const open = jobs.filter((j) => j.status !== "cancelled");
  const st = tally(jobs, "status");
  const scheduled = jobs.filter((j) => j.evaluation_status === "scheduled");
  const upcoming = scheduled
    .filter((j) => str(j.evaluation_date) >= now)
    .sort((a, b) => str(a.evaluation_date).localeCompare(str(b.evaluation_date)));
  const stale = scheduled.length - upcoming.length;
  const evalsDone = jobs.filter((j) => j.evaluation_status === "completed");
  const propBy = (s: string) => proposals.filter((p) => p.status === s);
  const sum = (l: Row[]) => l.reduce((s, p) => s + num(p.total_cost), 0);
  const accepted = propBy("accepted").length;
  const declined = propBy("declined").length;
  const waitingApproval = propBy("needs_approval");
  const kinds = tally(msgs, "kind");
  const evalKinds = ["evaluation_confirmed", "evaluation_booked", "evaluation_after", "evaluation_day_before",
    "evaluation_morning_of", "evaluation_two_days", "pre_eval_ask"];
  const evalMsgs = evalKinds.reduce((s, k) => s + (kinds.get(k) ?? 0), 0);
  const callOutcomes = tally(calls, "outcome");
  const appr = tally(approvals, "status");
  const rulesOn = rules.filter((r) => r.enabled);
  const activeServices = services.filter((s) => s.status === "active");
  const priced = activeServices.filter((s) => s.cost != null);
  const paidInvoices = invoices.filter((i) => i.status === "paid");
  const sync = ghl.find((g) => g.organization_id === orgId) ?? ghl[0];
  // Whoever has the most visits stands in for "an evaluator" in the preview.
  const assignedEvals = tally(scheduled.concat(evalsDone), "assigned_to");
  const sampleEvaluatorId = [...assignedEvals.entries()].filter(([k]) => k !== "(none)").sort((a, b) => b[1] - a[1])[0]?.[0];
  const sampleName = sampleEvaluatorId ? name(sampleEvaluatorId) : "an evaluator";
  const evaluators = profiles.filter((p) => p.does_evaluations);
  const visitRow = (j: Row) => `${when(j.evaluation_date)} · ${place(j.name)} · ${name(j.assigned_to)}`;
  const ruleLabel: Record<string, string> = {
    evaluation_confirmed: "Evaluation confirmed",
    evaluation_reminder: "Evaluation reminder",
    job_start_reminder: "Job start reminder",
    proposal_follow_up: "Proposal follow-up",
    invoice_reminder: "Invoice reminder",
  };

  const pillars: V2Pillar[] = [
    {
      id: "pipeline", label: "Pipeline", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(open.length)} open jobs · synced with GoHighLevel`,
      title: "Pipeline", sub: "Where every lead stands, from first contact to signed job.",
      blocks: [
        {
          t: "Stage board", v: n(open.length), d: `Open jobs by stage (${n(st.get("cancelled") ?? 0)} cancelled not shown)`,
          rows: ["estimating", "quoted", "approved", "completed"].map((s) => `${s[0].toUpperCase() + s.slice(1)} · ${n(st.get(s) ?? 0)}`),
        },
        {
          t: "Lead source", v: n(jobs.filter((j) => j.referral_code || j.referred_by_profile_id).length),
          d: "Jobs with a referral code or affiliate attached",
          rows: [
            `Referral code on job · ${n(jobs.filter((j) => j.referral_code).length)}`,
            `Referred by an affiliate · ${n(jobs.filter((j) => j.referred_by_profile_id).length)}`,
          ],
        },
        { t: "Close rate", v: pct(accepted, accepted + declined), d: `${accepted} signed of ${accepted + declined} proposals with an answer` },
        { t: "GoHighLevel sync", v: sync ? "OK" : "—", d: sync ? `Last pulled ${day(sync.last_pulled_at)} · ${str(sync.last_result)}` : "No sync on record" },
      ],
      links: [{ label: "Pipeline", href: "/pipeline" }],
    },
    {
      id: "booking", label: "Evaluation booking", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(bookVisits)} booking page visits · ${n(booked)} booked`,
      title: "Evaluation booking", sub: "Leads pick a time for an evaluator to visit.",
      blocks: [
        { t: "Booking link", v: n(bookVisits), d: `Booking page visits in 30 days · ${n(booked)} booked` },
        { t: "Availability", v: n(avail), d: `Weekly time blocks · ${n(daysOff)} days off` },
        {
          t: "Scheduled evaluations", v: n(scheduled.length), d: "Upcoming visits",
          rows: [...upcoming.slice(0, 6).map(visitRow), ...(stale ? [`${stale} past their date and still marked scheduled`] : [])],
        },
        { t: "Pre-visit questions", v: n(intakes.filter((i) => i.submitted_at).length), d: `Filled in before the visit (${n(intakes.length)} sent)` },
      ],
      links: [
        { label: "Calendar", href: "/evaluations" },
        { label: "Booking page", href: "/admin/booking-page" },
      ],
    },
    {
      id: "reminders", label: "Appointment reminders", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(evalMsgs)} evaluation reminders and confirmations sent`,
      title: "Appointment reminders", sub: "Nobody forgets a visit.",
      blocks: [
        {
          t: "Customer reminders", v: n(evalMsgs), d: "Evaluation emails and texts sent",
          rows: evalKinds.filter((k) => kinds.get(k)).map((k) => `${k.replace(/_/g, " ")} · ${n(kinds.get(k) ?? 0)}`),
        },
        { t: "Evaluator reminders", v: n(teamRem), d: "Team reminders sent" },
        {
          t: "Rules switched on", v: `${rulesOn.length} of ${rules.length}`, d: "Automatic reminder rules",
          rows: rules.map((r) => `${ruleLabel[str(r.kind)] ?? str(r.kind)} · ${r.enabled ? "on" : "off"}`),
        },
        { t: "Job start notices", v: n(kinds.get("job_start_reminder") ?? 0), d: "Texts sent before a crew arrives" },
      ],
      links: [{ label: "Client reminders", href: "/admin/reminders" }],
    },
    {
      id: "proposals", label: "Proposals", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(proposals.length)} proposals · ${accepted} signed · ${usd(sum(propBy("accepted")))}`,
      title: "Proposals", sub: "From measurements to a signed job. Pricing formulas live here.",
      blocks: [
        {
          t: "Pricing formulas", v: n(activeServices.length), d: `Active services · ${priced.length} with a rate`,
          rows: priced.map((s) => `${str(s.name)} · $${num(s.cost)} ${str(s.cost_unit)}`),
        },
        { t: "Proposals made", v: n(proposals.length), d: `${n(views)} views` },
        {
          t: "Tracking", v: usd(sum(proposals)), d: "Total value proposed",
          rows: [
            `Signed · ${accepted} · ${usd(sum(propBy("accepted")))}`,
            `Declined · ${declined} · ${usd(sum(propBy("declined")))}`,
            `Sent, waiting · ${propBy("sent").length} · ${usd(sum(propBy("sent")))}`,
            `Needs your approval · ${waitingApproval.length} · ${usd(sum(waitingApproval))}`,
          ],
        },
        { t: "E-sign + deposit", v: usd(paidInvoices.reduce((s, i) => s + num(i.amount), 0)), d: `${paidInvoices.length} invoices paid` },
      ],
      links: [
        { label: "Proposals", href: "/proposals" },
        { label: "Service pricing", href: "/admin/service-pricing" },
        { label: "Production rates", href: "/admin/production-rates" },
      ],
    },
    {
      id: "followup", label: "Automated follow-up", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(kinds.get("proposal_follow_up") ?? 0)} follow-up emails · ${n(calls.length)} calls logged`,
      title: "Automated follow-up", sub: "Keeps chasing until a lead says yes or no.",
      blocks: [
        { t: "Unsigned proposal", v: n(kinds.get("proposal_follow_up") ?? 0), d: "Follow-up emails sent" },
        {
          t: "Call log", v: n(calls.length), d: "Calls about proposals",
          rows: [...callOutcomes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/_/g, " ")} · ${v}`),
        },
        {
          t: "Messages needing approval", v: n(approvals.length), d: "Outbound messages",
          rows: [...appr.entries()].map(([k, v]) => `${k} · ${v}`),
        },
      ],
      links: [{ label: "Conversations", href: "/conversations" }],
    },
    {
      id: "myevals", label: "My evaluations", kind: "auto", who: ["evaluator"],
      title: "My evaluations", sub: `Your visits, measurements and proposals in one place. (Showing ${sampleName}.)`,
      blocks: [
        {
          t: "Upcoming visits", v: n(upcoming.filter((j) => j.assigned_to === sampleEvaluatorId).length), d: "Coming up",
          rows: upcoming.filter((j) => j.assigned_to === sampleEvaluatorId).slice(0, 6).map(visitRow),
        },
        { t: "Measure", v: n(evalsDone.filter((j) => j.assigned_to === sampleEvaluatorId).length), d: "Evaluations completed" },
        { t: "Waiting on owner approval", v: n(waitingApproval.length), d: "Proposals priced and waiting" },
      ],
      links: [{ label: "My visits", href: "/evaluate" }],
    },
    {
      id: "evaluators", label: "Evaluators", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(evaluators.length)} active · ${n(evalsDone.length)} evaluations completed`,
      title: "Evaluators", sub: "Lead closers who visit, measure and propose.",
      blocks: [
        {
          t: "Roster", v: n(evaluators.length), d: "People who can be booked for an evaluation",
          rows: evaluators.map((e) => `${str(e.full_name) || str(e.email)} · ${e.commission_pct == null ? "no commission set" : e.commission_pct + "% commission"}`),
        },
        {
          t: "Completed evaluations", v: n(evalsDone.length), d: "By evaluator",
          rows: [...tally(evalsDone, "assigned_to").entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k === "(none)" ? "Unassigned" : name(k)} · ${v}`),
        },
      ],
      links: [{ label: "Team & services", href: "/admin/team" }],
    },
  ];

  return {
    key: "sales",
    name: "Sales",
    roles: [{ key: "owner", label: "Owner" }, { key: "evaluator", label: "Evaluator" }],
    groups: {
      a: { title: "Close leads", note: `${accepted} of ${accepted + declined} answered proposals signed.` },
      b: { title: "Get lead closers", note: "Evaluators visit the property, measure, and submit the proposal from the app." },
    },
    pillars: [overview("Sales overview", "Two jobs: close leads automatically, and grow the people who close them.", [], [{ label: "Current sales page", href: "/sales" }]), ...pillars],
    loadedAt: stamp(),
  };
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export async function loadOperations(): Promise<V2Section> {
  const sb = await db();
  const today = new Date().toISOString().slice(0, 10);
  const [sessions, jobs, materials, suppliers, kits, fleet, issues, reviews, roles, profiles, applicants, pending,
    crewEvents, assignments, scopeChanges, walks, waivers, photos, supplierProducts, toolsActive, rentals, loadouts,
    shopChecks, shopDays, avail, timeEntries, indeed] = await Promise.all([
    rows(sb, "job_work_sessions", "status,starts_on,purpose,job_id,kits"),
    rows(sb, "jobs", "id,name,status,final_crew_hours"),
    rows(sb, "materials", "name,quantity_on_hand,reorder_threshold,unit,active"),
    rows(sb, "material_suppliers", "name,delivery_minimum,active"),
    rows(sb, "kit_containers", "name,kits,archived_at"),
    rows(sb, "fleet_assets", "name,kind,year,make,model,condition,retired_on"),
    rows(sb, "job_issues", "status,title,severity,created_at"),
    rows(sb, "job_client_reviews", "status,job_id"),
    rows(sb, "profile_roles", "profile_id,role_name"),
    rows(sb, "profiles", "id,full_name,email"),
    rows(sb, "job_applicants", "position,stage,source,created_at"),
    rows(sb, "team_payments", "amount,status,period_start", (q) => q.eq("status", "pending")),
    count(sb, "crew_day_events"),
    count(sb, "job_crew_assignments"),
    count(sb, "job_scope_changes"),
    count(sb, "job_walkthroughs"),
    count(sb, "job_photo_waivers"),
    count(sb, "job_photos"),
    count(sb, "supplier_products"),
    count(sb, "tools", (q) => q.eq("active", true)),
    count(sb, "tools", (q) => q.eq("active", true).eq("is_rental", true)),
    count(sb, "loadout_checks"),
    count(sb, "crew_shop_checks"),
    count(sb, "crew_shop_days"),
    count(sb, "availability_weekly"),
    count(sb, "time_entries"),
    count(sb, "indeed_invites"),
  ]);

  const jobName = (id: unknown) => place(jobs.find((j) => j.id === id)?.name);
  const ss = tally(sessions, "status");
  const sched = sessions.filter((s) => s.status === "scheduled");
  const schedPast = sched.filter((s) => str(s.starts_on) < today);
  const schedNext = sched.filter((s) => str(s.starts_on) >= today).sort((a, b) => str(a.starts_on).localeCompare(str(b.starts_on)));
  const sessionRow = (s: Row) => `${day(str(s.starts_on) + "T12:00:00Z")} · ${str(s.purpose).slice(0, 60) || "Work day"} · ${jobName(s.job_id)}`;
  const js = tally(jobs, "status");
  const completed = jobs.filter((j) => j.status === "completed");
  const costed = completed.filter((j) => num(j.final_crew_hours) > 0).length;
  const below = materials.filter(
    (m) => m.quantity_on_hand != null && m.reorder_threshold != null && num(m.quantity_on_hand) < num(m.reorder_threshold)
  );
  const openIssues = issues.filter((i) => i.status === "open");
  const liveFleet = fleet.filter((f) => !f.retired_on);
  const crewIds = roles.filter((r) => r.role_name === "crew").map((r) => r.profile_id);
  const leadIds = roles.filter((r) => r.role_name === "project lead").map((r) => r.profile_id);
  const who = (id: unknown) => {
    const p = profiles.find((x) => x.id === id);
    return p ? str(p.full_name) || "[no name on profile]" : "Unknown";
  };
  const positions = tally(applicants, "position");
  const owed = pending.reduce((s, p) => s + num(p.amount), 0);

  const pillars: V2Pillar[] = [
    {
      id: "scheduling", label: "Scheduling", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(ss.get("done") ?? 0)} work days done · ${n(schedNext.length)} coming up`,
      title: "Scheduling", sub: "Signed jobs land on the calendar and stay organized.",
      blocks: [
        { t: "Calendar", v: n(sessions.length), d: "Work days on the books", rows: [`Done · ${n(ss.get("done") ?? 0)}`, `Coming up · ${n(schedNext.length)}`] },
        { t: "Coming up", v: n(schedNext.length), d: "Next work days", rows: schedNext.slice(0, 5).map(sessionRow) },
        { t: "Past date, never closed", v: n(schedPast.length), d: "Still marked scheduled", rows: schedPast.slice(-4).map(sessionRow) },
        { t: "Crew day tracking", v: n(crewEvents), d: "Check-ins: left shop, travelling, arrived, finished" },
      ],
      links: [{ label: "Calendar", href: "/evaluations" }, { label: "Operations", href: "/operations" }],
    },
    {
      id: "projects", label: "Projects", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(js.get("approved") ?? 0)} approved · ${n(js.get("completed") ?? 0)} completed · ${n(photos)} photos`,
      title: "Projects", sub: "The full file and status of every job.",
      blocks: [
        { t: "Project board", v: n((js.get("approved") ?? 0) + (js.get("completed") ?? 0)), d: "Signed jobs", rows: [`Approved, not finished · ${n(js.get("approved") ?? 0)}`, `Completed · ${n(js.get("completed") ?? 0)}`] },
        { t: "Project file", v: n(photos), d: `Job photos · ${n(walks)} walkthroughs` },
        { t: "Crew assignments", v: n(assignments), d: "People assigned to jobs" },
        { t: "Change orders", v: n(scopeChanges), d: "Scope changes recorded" },
      ],
      links: [{ label: "Project review", href: "/jobs/review" }, { label: "Operations", href: "/operations" }],
    },
    {
      id: "materials", label: "Materials & ordering", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(materials.length)} materials · ${n(below.length)} below reorder · ${n(suppliers.length)} suppliers`,
      title: "Materials & ordering", sub: "The right materials on site when the crew gets there.",
      blocks: [
        { t: "Below reorder point", v: n(below.length), d: "Need ordering", rows: below.map((m) => `${str(m.name).slice(0, 40)} · ${num(m.quantity_on_hand)} on hand (reorder at ${num(m.reorder_threshold)})`) },
        { t: "Material list", v: n(materials.length), d: `${n(materials.filter((m) => m.active).length)} active` },
        { t: "Suppliers", v: n(suppliers.length), d: `${n(supplierProducts)} products priced`, rows: suppliers.map((s) => `${str(s.name)}${s.delivery_minimum ? ` · ${num(s.delivery_minimum)} yd min` : ""}`) },
        { t: "Purchase orders", v: "0", d: "Not in the current app yet" },
      ],
      links: [{ label: "Materials", href: "/admin/materials" }, { label: "Bulk suppliers", href: "/admin/suppliers" }],
    },
    {
      id: "equipment", label: "Equipment & tools", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(toolsActive)} tools · ${n(kits.filter((k) => !k.archived_at).length)} kit containers · ${n(liveFleet.length)} vehicles`,
      title: "Equipment & tools", sub: "What goes out with each crew, and what comes back.",
      blocks: [
        { t: "Tools", v: n(toolsActive), d: `Active tools and gear · ${n(rentals)} rentals` },
        { t: "Kit containers", v: n(kits.filter((k) => !k.archived_at).length), d: "What the kits travel in", rows: kits.filter((k) => !k.archived_at).map((k) => `${str(k.name)} · kits ${(k.kits as number[] | null)?.join(", ") ?? "—"}`) },
        { t: "Load-out checks", v: n(loadouts), d: `${n(shopChecks)} shop checks over ${n(shopDays)} shop days` },
        { t: "Vehicles & trailers", v: n(liveFleet.length), d: "Condition on file", rows: liveFleet.map((f) => `${str(f.name)}${f.year ? ` · ${f.year} ${str(f.make)} ${str(f.model)}` : ""} · ${str(f.condition) || "—"}`) },
      ],
      links: [{ label: "Inventory", href: "/admin/tools" }, { label: "Kit checklists", href: "/admin/tools/kits" }, { label: "Fleet", href: "/admin/fleet" }],
    },
    {
      id: "closeout", label: "Completion & close-out", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(walks)} walkthroughs · ${n(reviews.length)} reviews · ${n(openIssues.length)} open issues`,
      title: "Completion & close-out", sub: "Finish clean and hand the job back.",
      blocks: [
        { t: "Final walkthrough", v: n(walks), d: `Walkthroughs · ${n(waivers)} photo waivers` },
        { t: "Customer sign-off", v: n(reviews.filter((r) => r.status === "approved").length), d: "Client reviews approved", rows: reviews.filter((r) => r.status === "approved").map((r) => jobName(r.job_id)) },
        { t: "Job costing", v: `${costed} of ${completed.length}`, d: "Completed jobs with final hours filled in" },
        { t: "Open issues", v: n(openIssues.length), d: `${n(issues.length)} logged`, rows: openIssues.map((i) => `${str(i.title)} · ${day(i.created_at)}`) },
      ],
      links: [{ label: "Project review", href: "/jobs/review" }],
    },
    {
      id: "mylead", label: "My projects", kind: "project", who: ["project-lead"],
      title: "My projects", sub: "Everything a project lead needs to run their jobs.",
      blocks: [
        { t: "Coming up", v: n(schedNext.length), d: "Work days", rows: schedNext.slice(0, 5).map(sessionRow) },
        { t: "Order materials", v: n(below.length), d: "Materials below reorder point" },
        { t: "Close out", v: n(walks), d: "Walkthroughs done" },
      ],
      links: [{ label: "My day", href: "/my-day" }],
    },
    {
      id: "mytech", label: "My day", kind: "project", who: ["project-technician"],
      title: "My day", sub: "What a project tech needs on the job.",
      blocks: [
        { t: "Next work days", v: n(schedNext.length), d: "Scheduled", rows: schedNext.slice(0, 3).map(sessionRow) },
        { t: "Clock in / out", v: n(crewEvents), d: "Crew check-ins recorded" },
        { t: "Photos", v: n(photos), d: "Job photos uploaded" },
      ],
      links: [{ label: "My day", href: "/my-day" }],
    },
    {
      id: "team", label: "Project team", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(crewIds.length)} crew · ${n(leadIds.length)} project leads`,
      title: "Project team", sub: "Everyone who runs and works the jobs.",
      blocks: [
        { t: "Project techs (crew)", v: n(crewIds.length), d: "People with the crew role", rows: crewIds.map(who) },
        { t: "Project leads", v: n(leadIds.length), d: "People with the project lead role", rows: leadIds.map(who) },
        { t: "Availability", v: n(avail), d: "Weekly time blocks" },
        { t: "Hours & pay", v: usd(owed), d: `${pending.length} pay periods pending · ${n(timeEntries)} time entries` },
      ],
      links: [{ label: "Team & services", href: "/admin/team" }],
    },
    {
      id: "hiring", label: "Hiring", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(applicants.length)} applicants`,
      title: "Hiring", sub: "Fill project lead and project tech positions.",
      blocks: [
        { t: "Applicants", v: n(applicants.length), d: "By position", rows: [...positions.entries()].map(([k, v]) => `${k.replace(/-/g, " ")} · ${v}`) },
        { t: "Newest", v: "", d: "", rows: [...applicants].sort((a, b) => str(b.created_at).localeCompare(str(a.created_at))).slice(0, 5).map((a) => `${day(a.created_at)} · ${str(a.position).replace(/-/g, " ")} · ${str(a.stage).replace(/_/g, " ")} · ${str(a.source)}`) },
        { t: "Indeed invites", v: n(indeed), d: "Sent" },
      ],
      links: [{ label: "Hiring", href: "/admin/hiring" }],
    },
  ];

  return {
    key: "operations",
    name: "Operations",
    roles: [{ key: "owner", label: "Owner" }, { key: "project-lead", label: "Project lead" }, { key: "project-technician", label: "Project tech" }],
    groups: {
      a: { title: "Run projects", note: "Everything that touches a project after it's signed. Pricing stays in Sales." },
      b: { title: "Build the project team", note: "Project leads run the job, project techs do the work." },
    },
    pillars: [overview("Operations overview", "Two jobs: run every project start to finish, and build the team that runs them.", [], [{ label: "Current operations page", href: "/operations" }]), ...pillars],
    loadedAt: stamp(),
  };
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export async function loadAdmin(): Promise<V2Section> {
  const sb = await db();
  const orgId = await getCurrentOrganizationId().catch(() => null);
  const [payments, profiles, roles, ghl, health, domains, locations, services, recent, proposals, jobs, issues, materials, fleet, posts, sessions, pending, advances,
    customers, cust30, sourced, msgs, jobMsgs, bankTx, bankAcc, recurring, perms, roleEdits, finder, designs, notifPrefs, notifLog] = await Promise.all([
    rows(sb, "payments", "amount_cents,received_at"),
    rows(sb, "profiles", "id,full_name,email,commission_pct"),
    rows(sb, "profile_roles", "profile_id,role_name"),
    rows(sb, "ghl_sync_state", "organization_id,last_pulled_at,last_result"),
    rows(sb, "payments_health", "organization_id,state,checked_at"),
    rows(sb, "email_domains", "hostname,status"),
    rows(sb, "business_locations", "name,address"),
    rows(sb, "services", "name,status"),
    rows(sb, "customers", "name,created_at,source", (q) => q.order("created_at", { ascending: false }).limit(5)),
    rows(sb, "job_proposals", "status,total_cost"),
    rows(sb, "jobs", "status,evaluation_status,evaluation_date,assigned_to"),
    rows(sb, "job_issues", "status"),
    rows(sb, "materials", "quantity_on_hand,reorder_threshold"),
    rows(sb, "fleet_assets", "condition,retired_on"),
    rows(sb, "social_posts", "status,scheduled_for"),
    rows(sb, "job_work_sessions", "status,starts_on"),
    rows(sb, "team_payments", "amount", (q) => q.eq("status", "pending")),
    rows(sb, "commission_advances", "amount,status"),
    count(sb, "customers"),
    count(sb, "customers", (q) => q.gte("created_at", since(30))),
    count(sb, "customers", (q) => q.not("source", "is", null)),
    count(sb, "client_message_log"),
    count(sb, "job_messages"),
    count(sb, "bank_transactions"),
    count(sb, "bank_accounts"),
    count(sb, "recurring_decisions"),
    count(sb, "role_permissions"),
    count(sb, "role_edit_log"),
    count(sb, "finder_computers"),
    count(sb, "canvas_designs"),
    count(sb, "notification_preferences"),
    count(sb, "notification_log"),
  ]);

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const total = payments.reduce((s, p) => s + num(p.amount_cents), 0) / 100;
  const byMonth = new Map<string, number>();
  for (const p of payments) {
    const m = str(p.received_at).slice(0, 7);
    if (m) byMonth.set(m, (byMonth.get(m) ?? 0) + num(p.amount_cents) / 100);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const best = [...months].sort((a, b) => b[1] - a[1])[0];
  const monthLabel = (m: string) => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const thisMonth = byMonth.get(today.slice(0, 7)) ?? 0;
  const lastMonthKey = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 15)).toISOString().slice(0, 7);
  const roleCounts = tally(roles, "role_name");
  const name = (id: unknown) => {
    const p = profiles.find((x) => x.id === id);
    return p ? str(p.full_name) || str(p.email) : "Unknown";
  };
  const ams = roles.filter((r) => r.role_name === "account manager").map((r) => r.profile_id);
  const sync = ghl.find((g) => g.organization_id === orgId) ?? ghl[0];
  const pay = health.find((g) => g.organization_id === orgId) ?? health[0];
  const svc = tally(services, "status");
  const dupes = [...tally(services.map((s) => ({ k: str(s.name).toLowerCase() })), "k").entries()].filter(([, v]) => v > 1);
  const acc = recent;
  const accepted = proposals.filter((p) => p.status === "accepted").length;
  const declined = proposals.filter((p) => p.status === "declined").length;
  const approval = proposals.filter((p) => p.status === "needs_approval");
  const approvalSum = approval.reduce((s, p) => s + num(p.total_cost), 0);
  const waiting = proposals.filter((p) => p.status === "sent").reduce((s, p) => s + num(p.total_cost), 0);
  const staleEvals = jobs.filter((j) => j.evaluation_status === "scheduled" && str(j.evaluation_date) < nowIso).length;
  const staleDays = sessions.filter((s) => s.status === "scheduled" && str(s.starts_on) < today).length;
  const latePosts = posts.filter((p) => p.status === "scheduled" && p.scheduled_for && str(p.scheduled_for) < nowIso).length;
  const low = materials.filter((m) => m.quantity_on_hand != null && m.reorder_threshold != null && num(m.quantity_on_hand) < num(m.reorder_threshold)).length;
  const failing = fleet.filter((f) => !f.retired_on && f.condition === "failing").length;
  const openIssues = issues.filter((i) => i.status === "open").length;
  const alerts = [
    approval.length ? `${approval.length} proposals need your approval (${usd(approvalSum)})` : "",
    staleEvals ? `${staleEvals} evaluations past date still “scheduled”` : "",
    staleDays ? `${staleDays} work days past date still “scheduled”` : "",
    latePosts ? `${latePosts} social posts past date, never posted` : "",
    low ? `${low} materials below reorder` : "",
    failing ? `${failing} vehicles/trailers marked failing` : "",
    openIssues ? `${openIssues} open job issues` : "",
  ].filter(Boolean);
  const approvedNotDone = jobs.filter((j) => j.status === "approved").length;

  const pillars: V2Pillar[] = [
    {
      id: "departments", label: "Departments", kind: "admin", who: ["owner", "account-manager"], group: "a",
      blurb: `${alerts.length} things flagged across the three departments`,
      title: "Departments", sub: "One place to keep Marketing, Sales and Operations on track.",
      blocks: [
        { t: "Marketing", v: n(cust30), d: "New contacts in 30 days" },
        { t: "Sales", v: pct(accepted, accepted + declined), d: `Close rate on answered proposals · ${usd(waiting)} waiting on clients` },
        { t: "Operations", v: n(approvedNotDone), d: "Approved jobs not finished" },
        { t: "Alerts", v: n(alerts.length), d: "Flagged right now", rows: alerts },
      ],
      links: [{ label: "Dashboard", href: "/dashboard" }, { label: "Alerts", href: "/notifications" }],
    },
    {
      id: "customers", label: "Customer accounts", kind: "admin", who: ["owner", "account-manager"], group: "a",
      blurb: `${n(customers)} customers · ${n(cust30)} new in 30 days`,
      title: "Customer accounts", sub: "Every customer across every department.",
      blocks: [
        { t: "Account list", v: n(customers), d: `Customers · ${n(cust30)} added in 30 days`, rows: acc.map((c) => `${str(c.name)} · ${day(c.created_at)}${c.source ? ` · ${str(c.source)}` : ""}`) },
        { t: "Lead source on file", v: n(sourced), d: `${n((customers ?? 0) - (sourced ?? 0))} customers have no source` },
        { t: "Communication", v: n(msgs), d: `Client emails and texts logged · ${n(jobMsgs)} job messages` },
        { t: "Issues & callbacks", v: n(issues.length), d: `${n(openIssues)} open` },
      ],
      links: [{ label: "Contacts", href: "/contacts" }, { label: "Conversations", href: "/conversations" }],
    },
    {
      id: "finance", label: "Finance", kind: "admin", who: ["owner"], group: "a",
      blurb: `${usd(total)} collected · ${usd(thisMonth)} this month`,
      title: "Finance", sub: "Money in, money out.",
      blocks: [
        {
          t: "Payments received", v: usd(total), d: `${n(payments.length)} payments`,
          rows: [...months.slice(-3).map(([m, v]) => `${monthLabel(m)} · ${usd(v)}`), ...(best ? [`Best month: ${monthLabel(best[0])} · ${usd(best[1])}`] : [])],
        },
        { t: "Last month", v: usd(byMonth.get(lastMonthKey) ?? 0), d: monthLabel(lastMonthKey) },
        { t: "Payroll", v: usd(pending.reduce((s, p) => s + num(p.amount), 0)), d: `${pending.length} pay periods pending` },
        { t: "Commissions", v: usd(advances.filter((a) => a.status === "paid").reduce((s, a) => s + num(a.amount), 0)), d: "Advances paid" },
        { t: "Bookkeeping", v: n(bankTx), d: `Bank transactions across ${n(bankAcc)} accounts · ${n(recurring)} recurring charges reviewed` },
      ],
      links: [{ label: "Money", href: "/admin/payments" }, { label: "Transactions", href: "/admin/transactions" }],
    },
    {
      id: "users", label: "Users & permissions", kind: "admin", who: ["owner"], group: "a",
      blurb: `${n(profiles.length)} users · ${n(roleCounts.size)} roles in use`,
      title: "Users & permissions", sub: "Who can log in and what they can see.",
      blocks: [
        { t: "Users", v: n(profiles.length), d: `${n(profiles.filter((p) => !p.full_name).length)} have no name filled in` },
        { t: "Roles in use", v: n(roleCounts.size), d: "To map onto the new roles", rows: [...roleCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} · ${v}`) },
        { t: "Page access rules", v: n(perms), d: "Role permissions defined today" },
        { t: "Activity log", v: n(roleEdits), d: "Role edits logged" },
      ],
      links: [{ label: "Settings & permissions", href: "/admin/settings" }, { label: "View as", href: "/admin/view-as" }],
    },
    {
      id: "integrations", label: "Integrations", kind: "admin", who: ["owner"], group: "a",
      blurb: "GoHighLevel, Stripe, email, banks",
      title: "Integrations", sub: "The connections the automations run on.",
      blocks: [
        { t: "GoHighLevel", v: sync ? (/[1-9]\d* failed/.test(str(sync.last_result)) ? "Errors" : "OK") : "—", d: sync ? `Last pull ${day(sync.last_pulled_at)} · ${str(sync.last_result)}` : "No sync on record" },
        { t: "Stripe payments", v: pay ? str(pay.state).toUpperCase() : "—", d: pay ? `Checked ${day(pay.checked_at)}` : "No check on record" },
        { t: "Email sending", v: n(domains.length), d: "Sending domains", rows: domains.map((d) => `${str(d.hostname)} · ${str(d.status)}`) },
        { t: "Banks", v: n(bankAcc), d: "Bank accounts connected" },
        { t: "Post finder extension", v: n(finder), d: "Computers running it" },
      ],
      links: [{ label: "Settings", href: "/admin/settings" }],
    },
    {
      id: "company", label: "Company & compliance", kind: "admin", who: ["owner"], group: "a",
      blurb: `${n(locations.length)} locations · ${n(designs)} design files`,
      title: "Company & compliance", sub: "The paperwork that keeps the business running.",
      blocks: [
        { t: "Locations", v: n(locations.length), d: "On file", rows: locations.map((l) => `${str(l.name).slice(0, 40)} · ${str(l.address).split(",").slice(1, 2).join("").trim()}`) },
        { t: "Contracts & legal wording", v: "0", d: "Not in the current app yet" },
        { t: "Documents & designs", v: n(designs), d: "Flyer and design files" },
      ],
      links: [{ label: "Organizations", href: "/admin/organizations" }],
    },
    {
      id: "settings", label: "Settings", kind: "admin", who: ["owner"], group: "a",
      blurb: `${n(services.length)} services on file · ${n(svc.get("active") ?? 0)} active`,
      title: "Settings", sub: "How the whole app is set up.",
      blocks: [
        {
          t: "Services", v: n(services.length), d: "On file",
          rows: [...[...svc.entries()].map(([k, v]) => `${k} · ${v}`), ...(dupes.length ? [`Duplicates: ${dupes.map(([k, v]) => `${k} ×${v}`).join(", ")}`] : [])],
        },
        { t: "Service area", v: "1", d: "Harford County" },
        { t: "Your notifications", v: n(notifLog), d: notifPrefs ? "Sent to you · your preferences are set" : "Sent to you · no preferences set yet" },
      ],
      links: [{ label: "Settings", href: "/admin/settings" }, { label: "Team & services", href: "/admin/team" }],
    },
    {
      id: "managers", label: "Account managers", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(ams.length)} account managers`,
      title: "Account managers", sub: "The people who oversee everything.",
      blocks: [
        { t: "Roster", v: n(ams.length), d: "People with the account manager role", rows: ams.map((id) => `${name(id)} · ${n(jobs.filter((j) => j.assigned_to === id).length)} jobs assigned`) },
      ],
      links: [{ label: "Team & services", href: "/admin/team" }],
    },
    {
      id: "hiring", label: "Hiring", kind: "people", who: ["owner"], group: "b",
      blurb: "Account manager hiring",
      title: "Hiring", sub: "Hire account managers.",
      blocks: [{ t: "Open positions", v: "0", d: "No account manager posting yet" }],
      links: [{ label: "Hiring", href: "/admin/hiring" }],
    },
    {
      id: "tasks", label: "Task list", kind: "admin", who: ["owner"], group: "a",
      blurb: "What's left to build in the new layout",
      title: "Task list", sub: "Every tab in the new layout that still has to be built.",
      blocks: [],
      links: [],
    },
  ];

  return {
    key: "admin",
    name: "Admin",
    roles: [{ key: "owner", label: "Owner" }, { key: "account-manager", label: "Account manager" }],
    groups: {
      a: { title: "Oversee & back office", note: "The departments, and everything behind the scenes." },
      b: { title: "Hire managers", note: "One position: account manager." },
    },
    pillars: [
      overview("Admin overview", "Oversee every department, run the back office, and hire the managers.", [
        { t: "Marketing", v: n(cust30), d: "New contacts in 30 days" },
        { t: "Sales", v: pct(accepted, accepted + declined), d: "Close rate on answered proposals" },
        { t: "Operations", v: n(approvedNotDone), d: "Approved jobs not finished" },
      ], [{ label: "Current admin page", href: "/admin" }]),
      ...pillars,
    ],
    loadedAt: stamp(),
  };
}

function overview(title: string, sub: string, blocks: V2Block[], links: V2Pillar["links"]): V2Pillar {
  return { id: "overview", label: "Overview", kind: "", who: ["owner", "account-manager"], title, sub, blocks, links };
}

export const V2_LOADERS = {
  marketing: loadMarketing,
  sales: loadSales,
  operations: loadOperations,
  admin: loadAdmin,
} as const;
