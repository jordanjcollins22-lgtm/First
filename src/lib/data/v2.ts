import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { attributionReport } from "@/lib/data/attribution";
import { loadWebsiteForEditor, type WebsiteState } from "@/lib/data/website";
import { loadAutomations } from "@/lib/data/automations";
import type { Automation } from "@/lib/automations";
import { row, type ListRow } from "@/lib/entities/types";
import { CHANNEL_LABEL } from "@/lib/attribution";
import { areaSlug } from "@/lib/website";
// Admin: rows that open in the drawer, the alerts it opens, and every connection.
import { row as entityRow } from "@/lib/entities/types";
import { ALERT_KEYS, alertLine, type AlertKey } from "@/lib/entities/handlers/admin-format";
import { listAppConnections, type AppConnection } from "@/lib/data/app-connections";

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
  /** Each row is words, or words that open something in the drawer. */
  rows?: ListRow[];
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
  view?: "website" | "automations";
  /** For view "automations": every automated message and who is in it. */
  automations?: Automation[];
  /** A combined pillar: the pillars it gathers, shown one under another. */
  parts?: V2Pillar[];
  /** Working screens shown above the numbers: keys into the panel registry. */
  panels?: string[];
  /** Each role's own home screen on this choice. */
  rolePanels?: Partial<Record<V2Role, string[]>>;
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
/** How many things a Marketing list shows; the drawer's own lists go further. */
const MKT_ROWS = 25;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export async function loadMarketing(viewerId: string | null = null): Promise<V2Section> {
  const sb = await db();
  const [
    links, posts, profiles, referredJobs,
    newContacts, seen, answers, finder, bookVisits, booked, located, salt, mow,
    reviews, proof, rank, adClicks, plays, prospectCounts, campaigns, advances,
    mailings, flyerRuns, pmCompanies, pmSent, groups, attribution, openPlays, website,
    saltOrders, mowOrders, googleReviews,
  ] = await Promise.all([
    rows(sb, "outreach_links", "id,platform,kind,click_count,profile_id,created_at,posted_comment,comment"),
    rows(sb, "social_posts", "status,channel,scheduled_for,hook,caption"),
    rows(sb, "profiles", "id,full_name,email,is_affiliate,affiliate_slug,commission_pct"),
    rows(sb, "jobs", "id,name,status,created_at,referred_by_profile_id", (q) => q.not("referred_by_profile_id", "is", null).order("created_at", { ascending: false })),
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
    rows(sb, "email_campaigns", "id,name,status,service_label,started_at", (q) => q.order("created_at", { ascending: false })),
    rows(sb, "commission_advances", "amount,status"),
    rows(sb, "eddm_mailings", "id,name,pieces,status,mailed_on", (q) => q.order("created_at", { ascending: false })),
    rows(sb, "flyer_runs", "id,name,mails_on,flyer_count,status", (q) => q.order("created_at", { ascending: false })),
    rows(sb, "pm_companies", "status"),
    count(sb, "pm_emails", (q) => q.eq("status", "sent")),
    rows(sb, "community_groups", "id,name,platform,member_count,archived_at"),
    attributionReport(365).catch(() => null),
    rows(sb, "marketing_plays", "kind,approval", (q) => q.eq("status", "open")),
    getCurrentOrganizationId()
      .then((id) => loadWebsiteForEditor(id))
      .catch(() => null),
    rows(sb, "salt_orders", "id,name,address,status,treatments,created_at", (q) => q.order("created_at", { ascending: false }).limit(MKT_ROWS)),
    rows(sb, "mow_orders", "id,name,address,status,called_at,created_at", (q) => q.order("created_at", { ascending: false }).limit(MKT_ROWS)),
    rows(sb, "google_reviews", "id,author,stars,body,reply_status,reviewed_at", (q) => q.order("reviewed_at", { ascending: false }).limit(200)),
  ]);

  const name = (id: unknown) => {
    const p = profiles.find((x) => x.id === id);
    return p ? str(p.full_name) || str(p.email) : "Unknown";
  };
  // Shown as an affiliate: only the replies they posted themselves.
  const comments = links.filter((l) => l.kind === "comment" && (!viewerId || l.profile_id === viewerId));
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
  const pendingPlays = openPlays.filter((p) => !p.approval || p.approval === "pending").length;
  const heldReviews = googleReviews.filter((r) => r.reply_status === "held" || r.reply_status === "failed");
  const reviewRow = (r: Row) =>
    row(
      `${"★".repeat(num(r.stars))} ${str(r.author) || "A Google user"} · ${str(r.reply_status) === "held" ? "reply waiting for you" : str(r.reply_status)}${r.body ? ` — ${str(r.body).slice(0, 60)}` : ""}`,
      "mkt.review",
      r.id
    );
  const pageRows: ListRow[] = website
    ? [
        row("Home page", "mkt.web_page", "home"),
        ...website.content.areas.map((a) => row(`${a.town} page`, "mkt.web_page", `area:${areaSlug(a.town)}`)),
        row(`Quick mow page${website.content.showQuickMow ? "" : " (hidden)"}`, "mkt.web_page", "quick-mow"),
        row(`Salt pre-book page${website.content.showSalt ? "" : " (hidden)"}`, "mkt.web_page", "salt"),
      ]
    : [];
  const channels: [string, string][] = [
    ["facebook", "Facebook"], ["nextdoor", "Nextdoor"], ["instagram", "Instagram"],
    ["google", "Google Business posts"], ["tiktok", "TikTok"], ["youtube", "YouTube"],
  ];

  const pillars: V2Pillar[] = [
    {
      id: "website", label: "Website", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(bookVisits)} visits · ${n(booked)} booked (30 days)`,
      title: "Website", sub: "Your website and every page a customer lands on. Edit it, preview it on a phone or a desktop, and publish.",
      view: "website",
      blocks: [
        { t: "Booking page", v: n(bookVisits), d: `Visits in 30 days · ${n(booked)} booked · ${pct(booked ?? 0, bookVisits ?? 0)}` },
        ...(pageRows.length ? [{ t: "Pages", v: n(pageRows.length), d: "Every page on the site. Open one to change it or take it down.", rows: pageRows }] : []),
        {
          t: "Salt pre-book", v: n(salt), d: "Prepaid ice melt orders, newest first",
          rows: saltOrders.map((o) => row(`${str(o.name)} · ${place(o.address)} · ${n(num(o.treatments))} treatments · ${str(o.status)} · ${day(o.created_at)}`, "mkt.salt_order", o.id)),
        },
        {
          t: "Quick mow page", v: n(mow), d: "Orders, newest first",
          rows: mowOrders.map((o) => row(`${str(o.name)} · ${place(o.address)} · ${str(o.status)}${o.called_at ? " · called" : " · not called"} · ${day(o.created_at)}`, "mkt.mow_order", o.id)),
        },
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
          rows: [
            ...(pendingPlays ? [row(`Waiting for approval · ${n(pendingPlays)}`, "mkt.play_list", "pending")] : []),
            ...[...tally(openPlays, "kind")].map(([k, c]) => row(`${PLAY_LABEL[k] ?? k} · ${n(c)}`, "mkt.play_list", k)),
          ],
        },
        { t: "Plays in total", v: n(plays), d: "Every hanger run, sign, knock and flyer drop on file" },
        {
          t: "EDDM mailings", v: n(mailings.length), d: `${n(mailings.reduce((a, m) => a + num(m.pieces), 0))} pieces planned or mailed`,
          rows: mailings.slice(0, MKT_ROWS).map((m) => row(`${str(m.name)} · ${n(num(m.pieces))} pieces · ${str(m.status)}${m.mailed_on ? ` · ${day(m.mailed_on)}` : ""}`, "mkt.mailing", m.id)),
        },
        {
          t: "Shared flyer runs", v: n(flyerRuns.length), d: "Flyers with paid ad squares from other local businesses",
          rows: flyerRuns.slice(0, MKT_ROWS).map((f) => row(`${str(f.name)} · ${n(num(f.flyer_count))} flyers · ${str(f.status)}${f.mails_on ? ` · ${day(f.mails_on)}` : ""}`, "mkt.flyer_run", f.id)),
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
          rows: PROSPECT_STATUSES.map((st, i) => row(`${cap(st)} · ${n(prospectCounts[i])}`, "mkt.prospect_list", st)),
        },
      ],
      links: [],
    },
    {
      id: "email", label: "Email", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(campaigns.filter((c) => c.status === "running").length)} running · ${n(pmSent)} property manager emails sent`,
      title: "Email", sub: "Offers to past and nearby clients, and cold email to local property managers, a few at a time.",
      blocks: [
        {
          t: "Campaigns", v: n(campaigns.length), d: "Offers to clients: draft, running, paused and done",
          rows: campaigns.slice(0, MKT_ROWS).map((c) => row(`${str(c.name)} · ${str(c.service_label)} · ${str(c.status)}${c.started_at ? ` · started ${day(c.started_at)}` : ""}`, "mkt.campaign", c.id)),
        },
        {
          t: "Property managers", v: n(pmCompanies.length),
          d: `${n(pmSent)} emails sent · ${n(pmCompanies.filter((c) => c.status === "replied" || c.status === "interested").length)} replied or interested`,
          rows: [...tally(pmCompanies, "status")].map(([k, c]) => row(`${cap(k.replace(/_/g, " "))} · ${n(c)}`, "mkt.pm_list", k)),
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
      id: "seo", label: "Google", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(reviews)} reviews · ${n(adClicks)} ad clicks`,
      title: "Google", sub: "How people find us on Google: reviews, search ranking and ads.",
      blocks: [
        {
          t: "Google reviews", v: n(googleReviews.length), d: heldReviews.length ? `${n(heldReviews.length)} replies waiting for you` : "Newest first",
          rows: [...heldReviews, ...googleReviews.filter((r) => !heldReviews.includes(r))].slice(0, MKT_ROWS).map(reviewRow),
        },
        { t: "Client reviews approved", v: n(reviews), d: `${n(proof)} shown as proof on the booking page` },
        { t: "Search ranking", v: n(rank), d: rank ? "Search terms tracked" : "No search terms tracked yet" },
        { t: "Ad clicks", v: n(adClicks), d: "Google and Facebook ad clicks recorded at booking" },
      ],
      links: [],
    },
    {
      id: "social", label: "Social media", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(links.length)} links · ${n(clicks(links))} clicks`,
      title: "Social media", sub: "Every channel and the neighborhood groups we run, posting and replying on their own.",
      blocks: [
        {
          t: "Channels", v: n(links.length), d: "Tracked links shared, by channel",
          rows: channels.map(([k, label]) => {
            const l = byPlatform(k);
            return row(`${label} · ${n(l.length)} links · ${n(clicks(l))} clicks`, "mkt.link_list", k);
          }),
        },
        {
          t: "Post queue", v: n(posts.length), d: "Before-and-after posts",
          rows: [
            row(`Scheduled · ${n(postStatus.get("scheduled") ?? 0)}`, "mkt.post_list", "scheduled"),
            ...(dueLate ? [row(`Past their time, not posted · ${n(dueLate)}`, "mkt.post_list", "late")] : []),
            row(`Drafts · ${n(postStatus.get("draft") ?? 0)}`, "mkt.post_list", "draft"),
            row(`Posted · ${n(postStatus.get("posted") ?? 0)}`, "mkt.post_list", "posted"),
            row(`Skipped · ${n(postStatus.get("skipped") ?? 0)}`, "mkt.post_list", "skipped"),
          ],
        },
        {
          t: "Local groups", v: n(liveGroups.length), d: "Groups we run, members as last counted",
          rows: liveGroups.map((g) => row(`${str(g.name)} · ${str(g.platform)}${g.member_count == null ? "" : ` · ${n(num(g.member_count))} members`}`, "mkt.group", g.id)),
        },
      ],
      links: [
        { label: "Before & after posts", href: "/admin/social" },
        { label: "Local groups", href: "/admin/groups" },
      ],
    },
    {
      id: "comments", label: "Comment replies", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(comments.length)} replies · ${n(clicks(comments))} clicks`,
      title: "Comment replies", sub: "Finds local posts asking for help and replies with a tracked link.",
      blocks: [
        { t: "Posts scanned", v: n(seen), d: `Post finder running on ${n(finder)} computers` },
        {
          t: "Replies posted", v: n(comments.length), d: `${n(clicks(comments))} link clicks · ${n(answers)} drafted answers`,
          rows: viewerId ? [] : [row("Every reply, newest first", "mkt.link_list", "replies")],
        },
        {
          t: "Latest replies", v: n(latest.length), d: "Newest first",
          rows: latest.map((l) =>
            row(
              `${day(l.created_at)} · ${name(l.profile_id)} · ${str(l.platform)} · ${n(num(l.click_count))} clicks — ${(str(l.posted_comment) || str(l.comment)).slice(0, 90)}…`,
              "mkt.outreach_link",
              l.id
            )
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
            return row(
              `${str(a.full_name) || "[no name]"} · code ${str(a.affiliate_slug) || "—"} · ${n(mine.length)} links · ${n(clicks(mine))} clicks · ${n(
                refBy.get(str(a.id)) ?? 0
              )} projects · ${a.commission_pct == null ? "rate not set" : a.commission_pct + "%"}`,
              "mkt.affiliate",
              a.id
            );
          }),
        },
        {
          t: "Projects referred", v: n(referredJobs.length), d: "Jobs with an affiliate attached, newest first",
          rows: referredJobs.slice(0, MKT_ROWS).map((j) => row(`${place(j.name)} · ${name(j.referred_by_profile_id)} · ${str(j.status)} · ${day(j.created_at)}`, "mkt.referred_job", j.id)),
        },
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

/** A Sales row that opens its thing in the drawer (the same shape as entities' row()). */
const salesRow = (text: string, kind: string, id: unknown): ListRow => (typeof id === "string" && id ? { text, ref: { kind, id } } : text);
/** The client's name on a job row read with its property and customer. */
const clientOf = (j: Row) => str(((j.property as Row | null)?.customer as Row | null)?.name);
/** "12 Haystack Court, Forest Hill · Jane Smith" */
const jobLabel = (j: Row) => {
  const where = place((j.property as Row | null)?.address ?? j.name);
  const who = clientOf(j);
  return who ? `${where} · ${who}` : where;
};
const SALES_CAP = 25;

/** viewerId: the person the page is being shown as, for the views that are about "my" work. */
export async function loadSales(viewerId: string | null = null): Promise<V2Section> {
  const sb = await db();
  const orgId = await getCurrentOrganizationId().catch(() => null);
  const [jobs, proposals, profiles, calls, approvals, intakes, invoices, services, ghl,
    views, avail, daysOff, bookVisits, booked, bookedRows, clients, clientCount] = await Promise.all([
    rows(sb, "jobs", "id,name,status,evaluation_status,evaluation_date,assigned_to,referral_code,referred_by_profile_id,created_at,property:properties(address,customer:customers(id,name))"),
    rows(sb, "job_proposals", "id,status,total_cost,discount_amount,job_id,created_at,sent_at,expires_at,responded_at"),
    rows(sb, "profiles", "id,full_name,email,does_evaluations,commission_pct"),
    rows(sb, "proposal_calls", "id,outcome,proposal_id,job_id,created_at", (q) => q.order("created_at", { ascending: false })),
    rows(sb, "outbound_approvals", "id,status,subject,kind,to_name,to_email,created_at"),
    rows(sb, "evaluation_intakes", "job_id,submitted_at"),
    rows(sb, "invoices", "id,job_id,status,amount,created_at,paid_at", (q) => q.order("created_at", { ascending: false })),
    rows(sb, "services", "service_type_id,name,status,cost,cost_unit"),
    rows(sb, "ghl_sync_state", "organization_id,last_pulled_at,last_result"),
    count(sb, "proposal_views"),
    count(sb, "availability_weekly"),
    count(sb, "availability_days_off"),
    count(sb, "booking_visits", (q) => q.gte("created_at", since(30))),
    count(sb, "booking_visits", (q) => q.gte("created_at", since(30)).not("booked_job_id", "is", null)),
    rows(sb, "booking_visits", "booked_job_id,booked_at", (q) => q.gte("created_at", since(30)).not("booked_job_id", "is", null).order("booked_at", { ascending: false }).limit(SALES_CAP)),
    rows(sb, "customers", "id,name,do_not_contact,created_at", (q) => q.order("created_at", { ascending: false }).limit(SALES_CAP)),
    count(sb, "customers"),
  ]);
  const automations = orgId ? await loadAutomations(sb, orgId).catch((e) => (console.error("v2 automations failed:", e), null)) : null;

  const now = new Date().toISOString();
  const name = (id: unknown) => {
    const p = profiles.find((x) => x.id === id);
    return p ? str(p.full_name) || str(p.email) : "Unassigned";
  };
  const jobById = new Map(jobs.map((j) => [str(j.id), j]));
  const jobText = (id: unknown) => {
    const j = jobById.get(str(id));
    return j ? jobLabel(j) : "A job";
  };
  const open = jobs.filter((j) => j.status !== "cancelled");
  const st = tally(jobs, "status");
  const scheduled = jobs.filter((j) => j.evaluation_status === "scheduled");
  const upcoming = scheduled
    .filter((j) => str(j.evaluation_date) >= now)
    .sort((a, b) => str(a.evaluation_date).localeCompare(str(b.evaluation_date)));
  const staleList = scheduled
    .filter((j) => j.evaluation_date && str(j.evaluation_date) < now)
    .sort((a, b) => str(b.evaluation_date).localeCompare(str(a.evaluation_date)));
  const stale = scheduled.length - upcoming.length;
  const evalsDone = jobs.filter((j) => j.evaluation_status === "completed");
  const propBy = (s: string) => proposals.filter((p) => p.status === s);
  const sum = (l: Row[]) => l.reduce((s, p) => s + num(p.total_cost), 0);
  const accepted = propBy("accepted").length;
  const declined = propBy("declined").length;
  const waitingApproval = propBy("needs_approval");
  const callOutcomes = tally(calls, "outcome");
  const appr = tally(approvals, "status");
  const pendingApprovals = approvals.filter((a) => a.status === "pending").sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)));
  const activeServices = services.filter((s) => s.status === "active");
  const priced = activeServices.filter((s) => s.cost != null);
  const unpriced = activeServices.filter((s) => s.cost == null);
  const paidInvoices = invoices.filter((i) => i.status === "paid");
  const sync = ghl.find((g) => g.organization_id === orgId) ?? ghl[0];
  // Whoever has the most visits stands in for "an evaluator" in the preview.
  const mine = (j: Row) => viewerId != null && j.assigned_to === viewerId;
  const myJobIds = new Set(jobs.filter(mine).map((j) => j.id));
  const evaluators = profiles.filter((p) => p.does_evaluations);
  const visitRow = (j: Row) => salesRow(`${when(j.evaluation_date)} · ${jobLabel(j)} · ${name(j.assigned_to)}`, "sales.evaluation", j.id);
  const jobRow = (j: Row) => salesRow(`${jobLabel(j)} · ${str(j.status).replace(/_/g, " ")}`, "sales.job", j.id);
  const proposalRow = (p: Row) =>
    salesRow(`${jobText(p.job_id)} · ${str(p.status).replace(/_/g, " ")} · ${usd(num(p.total_cost) - num(p.discount_amount))}`, "sales.proposal", p.id);
  // Most urgent first: waiting on the owner, then out with the client (soonest to expire), then the rest newest first.
  const urgency = (p: Row) => (p.status === "needs_approval" ? 0 : p.status === "sent" ? 1 : 2);
  const proposalsByUrgency = [...proposals].sort(
    (a, b) =>
      urgency(a) - urgency(b) ||
      (a.status === "sent" ? str(a.expires_at).localeCompare(str(b.expires_at)) : str(b.created_at).localeCompare(str(a.created_at)))
  );
  const decidedRecent = proposals
    .filter((p) => p.status === "accepted" || p.status === "declined")
    .sort((a, b) => str(b.responded_at).localeCompare(str(a.responded_at)));
  const newestOpen = [...open].sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)));
  const referred = jobs.filter((j) => j.referral_code || j.referred_by_profile_id).sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)));
  const answeredIntakes = intakes.filter((i) => i.submitted_at).sort((a, b) => str(b.submitted_at).localeCompare(str(a.submitted_at)));
  const invoiceRow = (i: Row) => salesRow(`${jobText(i.job_id)} · ${usd(num(i.amount))} · ${str(i.status)}${i.paid_at ? ` ${day(i.paid_at)}` : ""}`, "sales.invoice", i.id);

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
          t: "Leads and jobs", v: n(open.length), d: `Newest ${Math.min(SALES_CAP, open.length)} open: open one to change its status or evaluator, or add a note`,
          rows: newestOpen.slice(0, SALES_CAP).map(jobRow),
        },
        {
          t: "Clients", v: n(clientCount), d: "Newest first: contact details, jobs, messages and consent",
          rows: clients.map((c) => salesRow(`${str(c.name) || "Unnamed client"}${c.do_not_contact ? " · do not contact" : ""} · added ${day(c.created_at)}`, "sales.client", c.id)),
        },
        {
          t: "Lead source", v: n(referred.length),
          d: `Jobs with a referral code (${n(jobs.filter((j) => j.referral_code).length)}) or an affiliate (${n(jobs.filter((j) => j.referred_by_profile_id).length)}) attached`,
          rows: referred.slice(0, SALES_CAP).map(jobRow),
        },
        {
          t: "Close rate", v: pct(accepted, accepted + declined), d: `${accepted} signed of ${accepted + declined} proposals with an answer · latest answers below`,
          rows: decidedRecent.slice(0, SALES_CAP).map(proposalRow),
        },
        { t: "GoHighLevel sync", v: sync ? "OK" : "—", d: sync ? `Last pulled ${day(sync.last_pulled_at)} · ${str(sync.last_result)}` : "No sync on record" },
      ],
      links: [{ label: "Pipeline", href: "/pipeline" }],
    },
    {
      id: "booking", label: "Evaluation booking", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(bookVisits)} booking page visits · ${n(booked)} booked`,
      title: "Evaluation booking", sub: "Leads pick a time for an evaluator to visit.",
      blocks: [
        {
          t: "Booking link", v: n(bookVisits), d: `Booking page visits in 30 days · ${n(booked)} booked`,
          rows: bookedRows.map((b) => salesRow(`${day(b.booked_at)} · ${jobText(b.booked_job_id)}`, "sales.job", b.booked_job_id)),
        },
        { t: "Availability", v: n(avail), d: `Weekly time blocks · ${n(daysOff)} days off` },
        {
          t: "Scheduled evaluations", v: n(scheduled.length), d: `Upcoming visits${stale ? `, then ${stale} past their date and still marked scheduled` : ""}`,
          rows: [
            ...upcoming.slice(0, SALES_CAP - Math.min(10, staleList.length)).map(visitRow),
            ...staleList.slice(0, 10).map((j) => salesRow(`Past, still scheduled · ${when(j.evaluation_date)} · ${jobLabel(j)}`, "sales.evaluation", j.id)),
          ],
        },
        {
          t: "Pre-visit questions", v: n(answeredIntakes.length), d: `Filled in before the visit (${n(intakes.length)} sent)`,
          rows: answeredIntakes.slice(0, SALES_CAP).map((i) => salesRow(`${day(i.submitted_at)} · ${jobText(i.job_id)}`, "sales.evaluation", i.job_id)),
        },
      ],
      links: [
        { label: "Calendar", href: "/evaluations" },
        { label: "Booking page", href: "/admin/booking-page" },
      ],
    },
    {
      id: "proposals", label: "Proposals", kind: "auto", who: ["owner"], group: "a",
      blurb: `${n(proposals.length)} proposals · ${accepted} signed · ${usd(sum(propBy("accepted")))}`,
      title: "Proposals", sub: "From measurements to a signed job. Pricing formulas live here.",
      blocks: [
        {
          t: "Pricing formulas", v: n(activeServices.length), d: `Active services · ${priced.length} with a rate`,
          rows: [
            ...unpriced.map((s) => salesRow(`${str(s.name)} · no rate`, "sales.service", s.service_type_id)),
            ...priced.map((s) => salesRow(`${str(s.name)} · $${num(s.cost)} ${str(s.cost_unit)}`, "sales.service", s.service_type_id)),
          ],
        },
        {
          t: "Proposals made", v: n(proposals.length), d: `${n(views)} views · waiting on you first, then out with the client`,
          rows: proposalsByUrgency.slice(0, SALES_CAP).map(proposalRow),
        },
        {
          t: "Tracking", v: usd(sum(proposals)), d: "Total value proposed",
          rows: [
            `Signed · ${accepted} · ${usd(sum(propBy("accepted")))}`,
            `Declined · ${declined} · ${usd(sum(propBy("declined")))}`,
            `Sent, waiting · ${propBy("sent").length} · ${usd(sum(propBy("sent")))}`,
            `Needs your approval · ${waitingApproval.length} · ${usd(sum(waitingApproval))}`,
          ],
        },
        {
          t: "E-sign + deposit", v: usd(paidInvoices.reduce((s, i) => s + num(i.amount), 0)), d: `${paidInvoices.length} invoices paid · newest invoices below`,
          rows: invoices.slice(0, SALES_CAP).map(invoiceRow),
        },
      ],
      links: [
        { label: "Proposals", href: "/proposals" },
        { label: "Service pricing", href: "/admin/service-pricing" },
        { label: "Production rates", href: "/admin/production-rates" },
      ],
    },
    {
      id: "messages", label: "Automated messages", kind: "auto", who: ["owner"], group: "a",
      blurb: automations ? `${n(automations.sales.reduce((t, x) => t + x.people.length, 0))} people in automated messages` : "Not available",
      title: "Automated messages", sub: "Every message that goes out on its own, and who is in each one right now.",
      view: "automations", automations: automations?.sales ?? [],
      blocks: [
        {
          t: "Messages waiting for your approval", v: n(appr.get("pending") ?? 0),
          d: `Automatic emails held until you approve them · ${[...appr.entries()].map(([k, v]) => `${k} ${v}`).join(", ") || "none on record"}`,
          rows: pendingApprovals.slice(0, SALES_CAP).map((a) =>
            salesRow(`${str(a.subject) || str(a.kind).replace(/_/g, " ")} · to ${str(a.to_name) || str(a.to_email)} · ${day(a.created_at)}`, "sales.approval", a.id)
          ),
        },
        {
          t: "Calls about proposals", v: n(calls.length),
          d: `Logged by hand · ${[...callOutcomes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") || "none yet"}`,
          rows: calls.slice(0, SALES_CAP).map((c) => salesRow(`${day(c.created_at)} · ${str(c.outcome).replace(/_/g, " ")} · ${jobText(c.job_id)}`, "sales.proposal", c.proposal_id)),
        },
      ],
      links: [],
    },
    {
      // Replaced by the evaluator's own home screen (rolePanels); kept for the task list's links.
      id: "myevals", label: "My evaluations", kind: "auto", who: [],
      title: "My evaluations", sub: "Your visits, measurements and proposals in one place.",
      blocks: [
        {
          t: "Upcoming visits", v: n(upcoming.filter(mine).length), d: "Coming up",
          rows: upcoming.filter(mine).slice(0, SALES_CAP).map(visitRow),
        },
        {
          t: "Measure", v: n(evalsDone.filter(mine).length), d: "Evaluations completed",
          rows: evalsDone.filter(mine).sort((a, b) => str(b.evaluation_date).localeCompare(str(a.evaluation_date))).slice(0, SALES_CAP).map(visitRow),
        },
        {
          t: "Waiting on owner approval", v: n(waitingApproval.filter((p) => myJobIds.has(p.job_id)).length), d: "Your proposals, priced and waiting",
          rows: waitingApproval.filter((p) => myJobIds.has(p.job_id)).slice(0, SALES_CAP).map(proposalRow),
        },
      ],
      links: [{ label: "My visits", href: "/evaluate" }],
    },
    {
      id: "evaluators", label: "Evaluators", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(evaluators.length)} active · ${n(evalsDone.length)} evaluations completed`,
      title: "Evaluators", sub: "Lead closers who visit, measure and propose.",
      blocks: [
        {
          t: "Roster", v: n(evaluators.length), d: "People who can be booked for an evaluation: visits, scorecard, territory",
          rows: evaluators.map((e) => salesRow(`${str(e.full_name) || str(e.email)} · ${e.commission_pct == null ? "no commission set" : e.commission_pct + "% commission"}`, "sales.evaluator", e.id)),
        },
        {
          t: "Completed evaluations", v: n(evalsDone.length), d: "By evaluator",
          rows: [...tally(evalsDone, "assigned_to").entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (k === "(none)" ? `Unassigned · ${v}` : salesRow(`${name(k)} · ${v}`, "sales.evaluator", k))),
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

/** Lists in the Operations blocks stop here: newest or most urgent first. */
const OPS_CAP = 25;
const opsWords = (s: unknown) => str(s).replace(/[_-]+/g, " ");

export async function loadOperations(viewerId: string | null = null): Promise<V2Section> {
  const sb = await db();
  const today = new Date().toISOString().slice(0, 10);
  const automationsP = getCurrentOrganizationId()
    .then((orgId) => loadAutomations(sb, orgId))
    .catch((e) => (console.error("v2 automations failed:", e), null));
  const [sessions, jobs, materials, suppliers, kits, fleet, issues, reviews, roles, profiles, applicants, pending,
    crewEvents, assignments, scopeChanges, walks, waivers, photos, supplierProducts, toolsActive, rentals, loadouts,
    shopChecks, shopDays, avail, timeEntries, indeed] = await Promise.all([
    rows(sb, "job_work_sessions", "id,status,starts_on,ends_on,purpose,job_id,kits"),
    rows(sb, "jobs", "id,name,status,final_crew_hours,project_start_date,completed_at"),
    rows(sb, "materials", "id,name,quantity_on_hand,reorder_threshold,unit,active"),
    rows(sb, "material_suppliers", "id,name,delivery_minimum,active"),
    rows(sb, "kit_containers", "id,name,kits,archived_at"),
    rows(sb, "fleet_assets", "id,name,kind,year,make,model,condition,retired_on"),
    rows(sb, "job_issues", "id,job_id,status,title,severity,created_at"),
    rows(sb, "job_client_reviews", "id,status,job_id,sent_at"),
    rows(sb, "profile_roles", "profile_id,role_name"),
    rows(sb, "profiles", "id,full_name,email"),
    rows(sb, "job_applicants", "id,name,position,stage,source,created_at"),
    rows(sb, "team_payments", "id,profile_id,amount,status,period_start,period_end", (q) => q.eq("status", "pending")),
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

  // The things behind the counts, so each one can be opened: newest first, a page's worth.
  const [toolList, walkList, assignList, scopeList, eventList, loadoutList, availList, inviteList, exceptionList] = await Promise.all([
    rows(sb, "tools", "id,name,category,quantity,is_rental", (q) => q.eq("active", true).order("name").limit(OPS_CAP)),
    rows(sb, "job_walkthroughs", "id,job_id,status,requested_at", (q) => q.order("requested_at", { ascending: false }).limit(OPS_CAP)),
    rows(sb, "job_crew_assignments", "id,job_id,profile_id,role,assigned_at,unassigned_at", (q) => q.order("assigned_at", { ascending: false }).limit(OPS_CAP)),
    rows(sb, "job_scope_changes", "id,job_id,status,requested_at,requested_note", (q) => q.order("requested_at", { ascending: false }).limit(OPS_CAP)),
    rows(sb, "crew_day_events", "id,profile_id,kind,job_id,at", (q) => q.order("at", { ascending: false }).limit(OPS_CAP)),
    rows(sb, "loadout_checks", "profile_id,day", (q) => q.order("day", { ascending: false }).limit(300)),
    rows(sb, "availability_weekly", "profile_id"),
    rows(sb, "indeed_invites", "id,name,position,status,created_at,applicant_id", (q) => q.order("created_at", { ascending: false }).limit(OPS_CAP)),
    rows(sb, "job_exceptions", "id,job_id,summary,state,reported_at", (q) => q.in("state", ["reported", "acknowledged"]).order("reported_at", { ascending: false }).limit(OPS_CAP)),
  ]);

  // The person the page is shown as: their own jobs, check-ins and photos, for "My projects" and "My day".
  const [myCrew, myEvents, myWalks] = viewerId
    ? await Promise.all([
        rows(sb, "job_crew", "job_id", (q) => q.eq("profile_id", viewerId)),
        count(sb, "crew_day_events", (q) => q.eq("profile_id", viewerId)),
        rows(sb, "job_walkthroughs", "id,job_id,status,requested_at"),
      ])
    : [[], 0, []];
  const myJobIds = new Set(myCrew.map((c) => c.job_id));
  const myPhotos = viewerId && myJobIds.size ? await count(sb, "job_photos", (q) => q.in("job_id", [...myJobIds])) : 0;

  const jobName = (id: unknown) => place(jobs.find((j) => j.id === id)?.name);
  const ss = tally(sessions, "status");
  const sched = sessions.filter((s) => s.status === "scheduled");
  const schedPast = sched.filter((s) => str(s.starts_on) < today);
  const schedNext = sched.filter((s) => str(s.starts_on) >= today).sort((a, b) => str(a.starts_on).localeCompare(str(b.starts_on)));
  const mySchedNext = schedNext.filter((s) => myJobIds.has(s.job_id));
  const sessionText = (s: Row) => `${day(str(s.starts_on) + "T12:00:00Z")} · ${str(s.purpose).slice(0, 60) || "Work day"} · ${jobName(s.job_id)}`;
  const sessionRow = (s: Row) => row(sessionText(s), "ops.work_day", s.id);
  const recentSessions = [...sessions].sort((a, b) => str(b.starts_on).localeCompare(str(a.starts_on))).filter((s) => str(s.starts_on) <= today);
  const js = tally(jobs, "status");
  const completed = jobs.filter((j) => j.status === "completed");
  const costed = completed.filter((j) => num(j.final_crew_hours) > 0).length;
  const live = jobs
    .filter((j) => j.status === "approved" || j.status === "in_progress")
    .sort((a, b) => (str(a.project_start_date) || "9999").localeCompare(str(b.project_start_date) || "9999"));
  const jobRow = (j: Row) =>
    row(`${place(j.name)} · ${opsWords(j.status)}${j.project_start_date ? ` · starts ${day(str(j.project_start_date) + "T12:00:00Z")}` : ""}`, "ops.job", j.id);
  const below = materials.filter(
    (m) => m.quantity_on_hand != null && m.reorder_threshold != null && num(m.quantity_on_hand) < num(m.reorder_threshold)
  );
  const materialRow = (m: Row) => row(`${str(m.name).slice(0, 40)} · ${num(m.quantity_on_hand)} on hand (reorder at ${num(m.reorder_threshold)})`, "ops.material", m.id);
  const openIssues = issues.filter((i) => i.status === "open").sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)));
  const liveFleet = fleet.filter((f) => !f.retired_on);
  const liveKits = kits.filter((k) => !k.archived_at);
  const crewIds = roles.filter((r) => r.role_name === "crew").map((r) => r.profile_id);
  const leadIds = roles.filter((r) => r.role_name === "project lead").map((r) => r.profile_id);
  const who = (id: unknown) => {
    const p = profiles.find((x) => x.id === id);
    return p ? str(p.full_name) || "[no name on profile]" : "Unknown";
  };
  const personRow = (id: unknown) => row(who(id), "ops.crew_member", id);
  const positions = tally(applicants, "position");
  const owed = pending.reduce((s, p) => s + num(p.amount), 0);
  const newestApplicants = [...applicants].sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)));
  const walkRow = (w: Row) => row(`${jobName(w.job_id)} · ${opsWords(w.status)} · ${day(w.requested_at)}`, "ops.walkthrough", w.id);
  const reviewRow = (r: Row) => row(`${jobName(r.job_id)} · ${opsWords(r.status)}${r.sent_at ? ` · sent ${day(r.sent_at)}` : ""}`, "ops.review", r.id);
  const loadoutBy = new Map<string, { day: string; n: number }>();
  for (const l of loadoutList) {
    const k = str(l.profile_id);
    const cur = loadoutBy.get(k);
    if (!cur) loadoutBy.set(k, { day: str(l.day), n: 1 });
    else if (cur.day === str(l.day)) cur.n++;
  }
  const availBy = tally(availList, "profile_id");

  const automations = await automationsP;
  const pillars: V2Pillar[] = [
    {
      id: "scheduling", label: "Scheduling", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(ss.get("done") ?? 0)} work days done · ${n(schedNext.length)} coming up`,
      title: "Scheduling", sub: "Signed jobs land on the calendar and stay organized.",
      blocks: [
        {
          t: "Calendar", v: n(sessions.length), d: `Work days on the books · ${n(ss.get("done") ?? 0)} done · ${n(schedNext.length)} coming up`,
          rows: recentSessions.slice(0, OPS_CAP).map((s) => row(`${sessionText(s)} · ${opsWords(s.status)}`, "ops.work_day", s.id)),
        },
        { t: "Coming up", v: n(schedNext.length), d: "Next work days", rows: schedNext.slice(0, OPS_CAP).map(sessionRow) },
        { t: "Past date, never closed", v: n(schedPast.length), d: "Still marked scheduled", rows: schedPast.slice(-OPS_CAP).reverse().map(sessionRow) },
        {
          t: "Crew day tracking", v: n(crewEvents), d: "Check-ins: left shop, travelling, arrived, finished",
          rows: eventList.map((e) => row(`${who(e.profile_id)} · ${opsWords(e.kind)} · ${e.job_id ? jobName(e.job_id) : "shop"} · ${day(e.at)}`, "ops.crew_member", e.profile_id)),
        },
      ],
      links: [{ label: "Calendar", href: "/evaluations" }, { label: "Operations", href: "/operations" }],
    },
    {
      id: "projects", label: "Projects", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(js.get("approved") ?? 0)} approved · ${n(js.get("completed") ?? 0)} completed · ${n(photos)} photos`,
      title: "Projects", sub: "The full file and status of every job.",
      blocks: [
        {
          t: "Project board", v: n((js.get("approved") ?? 0) + (js.get("in_progress") ?? 0) + (js.get("completed") ?? 0)),
          d: `Signed jobs · ${n((js.get("approved") ?? 0) + (js.get("in_progress") ?? 0))} not finished · ${n(js.get("completed") ?? 0)} completed`,
          rows: live.slice(0, OPS_CAP).map(jobRow),
        },
        { t: "Project file", v: n(photos), d: `Job photos · ${n(walks)} walkthroughs (listed under Close-out)` },
        {
          t: "Crew assignments", v: n(assignments), d: "People assigned to jobs",
          rows: assignList.map((a) => row(`${who(a.profile_id)} · ${opsWords(a.role)} · ${jobName(a.job_id)}${a.unassigned_at ? " · taken off" : ""}`, "ops.job", a.job_id)),
        },
        {
          t: "Change orders", v: n(scopeChanges), d: "Scope changes recorded",
          rows: scopeList.map((c) => row(`${jobName(c.job_id)} · ${opsWords(c.status)} · ${day(c.requested_at)}${c.requested_note ? ` · ${str(c.requested_note).slice(0, 40)}` : ""}`, "ops.job", c.job_id)),
        },
      ],
      links: [{ label: "Project review", href: "/jobs/review" }, { label: "Operations", href: "/operations" }],
    },
    {
      id: "materials", label: "Materials & suppliers", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(materials.length)} materials · ${n(below.length)} below reorder · ${n(suppliers.length)} suppliers`,
      title: "Materials & suppliers", sub: "Every material we stock and who we buy it from. Orders are under Purchasing.",
      blocks: [
        {
          t: "Material list", v: n(materials.length), d: `${n(materials.filter((m) => m.active).length)} active`,
          rows: materials.filter((m) => m.active).sort((a, b) => str(a.name).localeCompare(str(b.name))).slice(0, OPS_CAP)
            .map((m) => row(`${str(m.name).slice(0, 40)}${m.quantity_on_hand != null ? ` · ${num(m.quantity_on_hand)} ${str(m.unit)} on hand` : ""}`, "ops.material", m.id)),
        },
        { t: "Suppliers", v: n(suppliers.length), d: `${n(supplierProducts)} products priced`, rows: suppliers.slice(0, OPS_CAP).map((s) => row(`${str(s.name)}${s.delivery_minimum ? ` · ${num(s.delivery_minimum)} yd min` : ""}`, "ops.supplier", s.id)) },
      ],
      links: [{ label: "Materials", href: "/admin/materials" }, { label: "Bulk suppliers", href: "/admin/suppliers" }],
    },
    {
      id: "equipment", label: "Tools & vehicles", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(toolsActive)} tools · ${n(liveKits.length)} kit containers · ${n(liveFleet.length)} vehicles`,
      title: "Tools & vehicles", sub: "What goes out with each crew, and what comes back. Servicing is under Equipment.",
      blocks: [
        {
          t: "Tools", v: n(toolsActive), d: `Active tools and gear · ${n(rentals)} rentals`,
          rows: toolList.map((t) => row(`${str(t.name)}${t.quantity != null ? ` · ${num(t.quantity)}` : ""}${t.is_rental ? " · rented" : ""}`, "ops.tool", t.id)),
        },
        { t: "Kit containers", v: n(liveKits.length), d: "What the kits travel in", rows: liveKits.slice(0, OPS_CAP).map((k) => row(`${str(k.name)} · kits ${(k.kits as number[] | null)?.join(", ") ?? "—"}`, "ops.kit", k.id)) },
        {
          t: "Load-out checks", v: n(loadouts), d: `${n(shopChecks)} shop checks over ${n(shopDays)} shop days`,
          rows: [...loadoutBy.entries()].slice(0, OPS_CAP).map(([pid, l]) => row(`${who(pid)} · last ticked ${day(l.day + "T12:00:00Z")} · ${l.n} items`, "ops.crew_member", pid)),
        },
        { t: "Vehicles & trailers", v: n(liveFleet.length), d: "Condition on file", rows: liveFleet.slice(0, OPS_CAP).map((f) => row(`${str(f.name)}${f.year ? ` · ${f.year} ${str(f.make)} ${str(f.model)}` : ""} · ${str(f.condition) || "—"}`, "ops.asset", f.id)) },
      ],
      links: [{ label: "Inventory", href: "/admin/tools" }, { label: "Kit checklists", href: "/admin/tools/kits" }, { label: "Fleet", href: "/admin/fleet" }],
    },
    {
      id: "closeout", label: "Close-out", kind: "project", who: ["owner"], group: "a",
      blurb: `${n(walks)} walkthroughs · ${n(reviews.length)} reviews · ${n(openIssues.length)} open issues`,
      title: "Completion & close-out", sub: "Finish clean and hand the job back.",
      blocks: [
        { t: "Final walkthrough", v: n(walks), d: `Walkthroughs · ${n(waivers)} photo waivers`, rows: walkList.map(walkRow) },
        {
          t: "Customer sign-off", v: n(reviews.filter((r) => r.status === "approved").length), d: `Client reviews approved · ${n(reviews.filter((r) => r.status !== "approved").length)} waiting or sent back`,
          rows: [...reviews].sort((a, b) => Number(a.status === "approved") - Number(b.status === "approved") || str(b.sent_at).localeCompare(str(a.sent_at))).slice(0, OPS_CAP).map(reviewRow),
        },
        {
          t: "Job costing", v: `${costed} of ${completed.length}`, d: "Completed jobs with final hours filled in",
          rows: [...completed].sort((a, b) => str(b.completed_at).localeCompare(str(a.completed_at))).slice(0, OPS_CAP)
            .map((j) => row(`${place(j.name)} · ${num(j.final_crew_hours) > 0 ? `${num(j.final_crew_hours)} crew hours` : "no final hours"}`, "ops.job", j.id)),
        },
        { t: "Open issues", v: n(openIssues.length), d: `${n(issues.length)} logged`, rows: openIssues.slice(0, OPS_CAP).map((i) => row(`${str(i.title)} · ${jobName(i.job_id)} · ${day(i.created_at)}`, "ops.issue", i.id)) },
        { t: "Open exceptions", v: n(exceptionList.length), d: "Reported from site, not settled", rows: exceptionList.map((e) => row(`${str(e.summary).slice(0, 60)} · ${jobName(e.job_id)} · ${opsWords(e.state)}`, "ops.exception", e.id)) },
      ],
      links: [{ label: "Project review", href: "/jobs/review" }],
    },
    {
      id: "mylead", label: "My projects", kind: "project", who: [],
      title: "My projects", sub: "Everything you need to run your jobs.",
      blocks: [
        { t: "Coming up", v: n(mySchedNext.length), d: "Your work days", rows: mySchedNext.slice(0, 5).map(sessionRow) },
        { t: "Order materials", v: n(below.length), d: "Materials below reorder point", rows: below.slice(0, OPS_CAP).map(materialRow) },
        { t: "Close out", v: n(myWalks.filter((w) => myJobIds.has(w.job_id)).length), d: "Walkthroughs done on your jobs", rows: myWalks.filter((w) => myJobIds.has(w.job_id)).slice(0, OPS_CAP).map(walkRow) },
      ],
      links: [{ label: "My day", href: "/my-day" }],
    },
    {
      id: "mytech", label: "My day", kind: "project", who: [],
      title: "My day", sub: "What you need on the job.",
      blocks: [
        { t: "Next work days", v: n(mySchedNext.length), d: "Scheduled for you", rows: mySchedNext.slice(0, 3).map(sessionRow) },
        { t: "Clock in / out", v: n(myEvents), d: "Your check-ins recorded" },
        { t: "Photos", v: n(myPhotos), d: "Photos on your jobs" },
      ],
      links: [{ label: "My day", href: "/my-day" }],
    },
    {
      id: "opsmessages", label: "Automated messages", kind: "project", who: ["owner"], group: "a",
      blurb: automations ? `${n(automations.operations.reduce((t, x) => t + x.people.length, 0))} people in automated messages` : "Not available",
      title: "Automated messages", sub: "Every message about the work that goes out on its own, and who is in each one right now.",
      view: "automations", automations: automations?.operations ?? [],
      blocks: [], links: [],
    },
    {
      id: "team", label: "Project team", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(crewIds.length)} crew · ${n(leadIds.length)} project leads`,
      title: "Project team", sub: "Everyone who runs and works the jobs.",
      blocks: [
        { t: "Project techs (crew)", v: n(crewIds.length), d: "People with the crew role", rows: crewIds.map(personRow) },
        { t: "Project leads", v: n(leadIds.length), d: "People with the project lead role", rows: leadIds.map(personRow) },
        { t: "Availability", v: n(avail), d: "Weekly time blocks", rows: [...availBy.entries()].slice(0, OPS_CAP).map(([pid, c]) => row(`${who(pid)} · ${c} block${c === 1 ? "" : "s"} a week`, "ops.crew_member", pid)) },
        {
          t: "Hours & pay", v: usd(owed), d: `${pending.length} pay periods pending · ${n(timeEntries)} time entries`,
          rows: [...pending].sort((a, b) => str(a.period_start).localeCompare(str(b.period_start))).slice(0, OPS_CAP)
            .map((p) => row(`${who(p.profile_id)} · ${usd(num(p.amount))}${p.period_start ? ` · ${day(str(p.period_start) + "T12:00:00Z")}` : ""}`, "ops.payment", p.id)),
        },
      ],
      links: [{ label: "Team & services", href: "/admin/team" }],
    },
    {
      id: "hiring", label: "Hiring", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(applicants.length)} applicants`,
      title: "Hiring", sub: "Fill project lead and project tech positions.",
      blocks: [
        { t: "Applicants", v: n(applicants.length), d: [...positions.entries()].map(([k, v]) => `${opsWords(k)} ${v}`).join(" · ") || "By position", rows: newestApplicants.filter((a) => !["not_a_fit", "withdrawn", "hired", "screened_out"].includes(str(a.stage))).slice(0, OPS_CAP).map((a) => row(`${str(a.name) || "Applicant"} · ${opsWords(a.position)} · ${opsWords(a.stage)}`, "ops.applicant", a.id)) },
        { t: "Newest", v: "", d: "", rows: newestApplicants.slice(0, 5).map((a) => row(`${day(a.created_at)} · ${str(a.name) || opsWords(a.position)} · ${opsWords(a.stage)} · ${str(a.source)}`, "ops.applicant", a.id)) },
        { t: "Indeed invites", v: n(indeed), d: "Sent", rows: inviteList.map((i) => row(`${str(i.name) || "Candidate"} · ${opsWords(i.position)} · ${opsWords(i.status)} · ${day(i.created_at)}`, "ops.indeed_invite", i.id)) },
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

/** The name on a joined row, e.g. a payment's customers(name). */
const joined = (r: Row, key: string) => str((r[key] as Row | null | undefined)?.name);

export async function loadAdmin(): Promise<V2Section> {
  const sb = await db();
  const orgId = await getCurrentOrganizationId().catch(() => null);
  const [payments, profiles, roles, ghl, health, domains, locations, services, recent, proposals, jobs, issues, materials, fleet, posts, sessions, pending,
    customers, cust30, sourced, msgs, jobMsgs, bankTx, bankAcc, recurring, perms, roleEdits, finder, designs, notifPrefs, notifLog,
    recentPayments, openInvoices, openUploads, recentBank, unsourced, recentMsgs, editLog, permRows, applicants, finders, connections] = await Promise.all([
    rows(sb, "payments", "amount_cents,received_at"),
    rows(sb, "profiles", "id,full_name,email,commission_pct"),
    rows(sb, "profile_roles", "profile_id,role_name"),
    rows(sb, "ghl_sync_state", "organization_id,last_pulled_at,last_result"),
    rows(sb, "payments_health", "organization_id,state,checked_at"),
    rows(sb, "email_domains", "hostname,status"),
    rows(sb, "business_locations", "id,name,address"),
    rows(sb, "services", "service_type_id,name,status"),
    rows(sb, "customers", "id,name,created_at,source", (q) => q.order("created_at", { ascending: false }).limit(25)),
    rows(sb, "job_proposals", "job_id,status,total_cost,sent_at"),
    rows(sb, "jobs", "id,name,status,evaluation_status,evaluation_date,assigned_to"),
    rows(sb, "job_issues", "id,title,status,created_at"),
    rows(sb, "materials", "id,name,unit,quantity_on_hand,reorder_threshold"),
    rows(sb, "fleet_assets", "id,name,condition,retired_on"),
    rows(sb, "social_posts", "id,hook,caption,status,scheduled_for"),
    rows(sb, "job_work_sessions", "id,job_id,status,starts_on"),
    rows(sb, "team_payments", "id,profile_id,amount,period_end", (q) => q.eq("status", "pending")),
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
    rows(sb, "payments", "id,amount_cents,method,received_at,payer_name,customers(name)", (q) => q.order("received_at", { ascending: false }).limit(25)),
    rows(sb, "invoices", "id,amount,created_at,jobs(name)", (q) => q.eq("status", "open").order("created_at", { ascending: true }).limit(25)),
    rows(sb, "client_invoices", "id,amount,issued_on,title,customers(name)", (q) => q.is("paid_on", null).not("amount", "is", null).order("issued_on", { ascending: true }).limit(25)),
    rows(sb, "bank_transactions", "id,name,merchant,amount,posted_on", (q) => q.order("posted_on", { ascending: false }).limit(25)),
    rows(sb, "customers", "id,name,created_at", (q) => q.is("source", null).order("created_at", { ascending: false }).limit(25)),
    rows(sb, "client_message_log", "id,channel,kind,status,created_at,customers(name)", (q) => q.order("created_at", { ascending: false }).limit(25)),
    rows(sb, "role_edit_log", "id,at,action,role_name,actor_name", (q) => q.order("at", { ascending: false }).limit(25)),
    rows(sb, "role_permissions", "role_name,granted"),
    rows(sb, "job_applicants", "id,name,position,stage,created_at", (q) => q.order("created_at", { ascending: false }).limit(25)),
    rows(sb, "finder_computers", "id,label,last_seen_at", (q) => q.order("last_seen_at", { ascending: false }).limit(25)),
    orgId ? listAppConnections(orgId).catch(() => [] as AppConnection[]) : Promise.resolve([] as AppConnection[]),
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
  const jobName = (id: unknown) => str(jobs.find((j) => j.id === id)?.name) || "Job";
  const ams = roles.filter((r) => r.role_name === "account manager").map((r) => r.profile_id);
  const sync = ghl.find((g) => g.organization_id === orgId) ?? ghl[0];
  const pay = health.find((g) => g.organization_id === orgId) ?? health[0];
  const svc = tally(services, "status");
  const dupes = [...tally(services.map((s) => ({ k: str(s.name).toLowerCase() })), "k").entries()].filter(([, v]) => v > 1);
  const accepted = proposals.filter((p) => p.status === "accepted").length;
  const declined = proposals.filter((p) => p.status === "declined").length;
  const approval = proposals.filter((p) => p.status === "needs_approval");
  const approvalSum = approval.reduce((s, p) => s + num(p.total_cost), 0);
  const sent = proposals.filter((p) => p.status === "sent");
  const waiting = sent.reduce((s, p) => s + num(p.total_cost), 0);
  const staleEvals = jobs.filter((j) => j.evaluation_status === "scheduled" && str(j.evaluation_date) < nowIso).length;
  const staleDays = sessions.filter((s) => s.status === "scheduled" && str(s.starts_on) < today).length;
  const latePosts = posts.filter((p) => p.status === "scheduled" && p.scheduled_for && str(p.scheduled_for) < nowIso).length;
  const low = materials.filter((m) => m.quantity_on_hand != null && m.reorder_threshold != null && num(m.quantity_on_hand) < num(m.reorder_threshold)).length;
  const failing = fleet.filter((f) => !f.retired_on && f.condition === "failing").length;
  const openIssues = issues.filter((i) => i.status === "open");
  // Each alert opens to the things in it.
  const alertCounts: Record<AlertKey, number> = {
    approvals: approval.length,
    stale_evals: staleEvals,
    stale_days: staleDays,
    late_posts: latePosts,
    low_materials: low,
    failing_fleet: failing,
    open_issues: openIssues.length,
  };
  const alerts: ListRow[] = ALERT_KEYS.filter((k) => alertCounts[k] > 0).map((k) =>
    entityRow(alertLine(k, alertCounts[k], k === "approvals" ? approvalSum : undefined), "admin.alert", k)
  );
  const approvedJobs = jobs.filter((j) => j.status === "approved");
  const approvedNotDone = approvedJobs.length;
  const customerRow = (c: Row) => entityRow(`${str(c.name) || "Customer"} · ${day(c.created_at)}${c.source ? ` · ${str(c.source)}` : ""}`, "admin.customer", c.id);
  const newCustomers = recent.filter((c) => str(c.created_at) >= since(30));
  const pendingPay = pending.reduce((s, p) => s + num(p.amount), 0);
  const roleRows = (counts: Map<string, number>, suffix: string) =>
    [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => entityRow(`${k} · ${v}${suffix}`, "admin.role", k));
  const pageRules = tally(permRows.filter((r) => r.granted !== false), "role_name");
  const connection = (id: string) => connections.find((c) => c.id === id);
  const openInvoiceRows: ListRow[] = [
    ...openInvoices.map((i) => entityRow(`${joined(i, "jobs") || "Job"} · ${usd(num(i.amount))} · sent ${day(i.created_at)}`, "admin.invoice", i.id)),
    ...openUploads.map((i) => entityRow(`${joined(i, "customers") || str(i.title) || "Client"} · ${usd(num(i.amount))} · issued ${day(i.issued_on)}`, "admin.invoice", i.id)),
  ].slice(0, 25);
  const sentRows = [...sent].sort((a, b) => str(a.sent_at).localeCompare(str(b.sent_at))).slice(0, 25).map((p) => entityRow(`${jobName(p.job_id)} · ${usd(num(p.total_cost))} · sent ${day(p.sent_at)}`, "admin.job", p.job_id));

  const pillars: V2Pillar[] = [
    {
      id: "customers", label: "Customer accounts", kind: "admin", who: ["owner", "account-manager"], group: "a",
      blurb: `${n(customers)} customers · ${n(cust30)} new in 30 days`,
      title: "Customer accounts", sub: "Every customer across every department.",
      blocks: [
        { t: "Account list", v: n(customers), d: `Customers · ${n(cust30)} added in 30 days · newest first`, rows: recent.map(customerRow) },
        { t: "Lead source on file", v: n(sourced), d: `${n((customers ?? 0) - (sourced ?? 0))} customers have no source`, rows: unsourced.map(customerRow) },
        {
          t: "Communication", v: n(msgs), d: `Client emails and texts logged · ${n(jobMsgs)} job messages`,
          rows: recentMsgs.map((m) => entityRow(`${day(m.created_at)} · ${joined(m, "customers") || "Client"} · ${str(m.channel).toUpperCase()} · ${str(m.kind).replace(/_/g, " ")} · ${str(m.status)}`, "admin.message", m.id)),
        },
        {
          t: "Issues & callbacks", v: n(issues.length), d: `${n(openIssues.length)} open`,
          rows: [...openIssues].sort((a, b) => str(b.created_at).localeCompare(str(a.created_at))).slice(0, 25).map((i) => entityRow(`${str(i.title) || "Issue"} · ${day(i.created_at)}`, "admin.job_issue", i.id)),
        },
      ],
      links: [{ label: "Contacts", href: "/contacts" }, { label: "Conversations", href: "/conversations" }],
    },
    {
      id: "finance", label: "Payments & bank", kind: "admin", who: ["owner"], group: "a",
      blurb: `${usd(total)} collected · ${usd(thisMonth)} this month`,
      title: "Payments & bank", sub: "Every payment, open invoice, pay period and bank transaction.",
      blocks: [
        {
          t: "Payments received", v: usd(total), d: `${n(payments.length)} payments`,
          rows: [...months.slice(-3).map(([m, v]) => `${monthLabel(m)} · ${usd(v)}`), ...(best ? [`Best month: ${monthLabel(best[0])} · ${usd(best[1])}`] : [])],
        },
        {
          t: "Latest payments", v: n(recentPayments.length), d: "Newest first",
          rows: recentPayments.map((p) => entityRow(`${day(p.received_at)} · ${joined(p, "customers") || str(p.payer_name) || "Unfiled"} · ${usd(num(p.amount_cents) / 100)} · ${str(p.method)}`, "admin.payment", p.id)),
        },
        { t: "Open invoices", v: n(openInvoiceRows.length), d: "Unpaid, oldest first", rows: openInvoiceRows },
        { t: "Last month", v: usd(byMonth.get(lastMonthKey) ?? 0), d: monthLabel(lastMonthKey) },
        {
          t: "Payroll", v: usd(pendingPay), d: `${pending.length} pay periods pending`,
          rows: pending.slice(0, 25).map((p) => entityRow(`${name(p.profile_id)} · ${usd(num(p.amount))}${p.period_end ? ` · to ${day(p.period_end)}` : ""}`, "admin.team_payment", p.id)),
        },
        {
          t: "Bookkeeping", v: n(bankTx), d: `Bank transactions across ${n(bankAcc)} accounts · ${n(recurring)} recurring charges reviewed`,
          rows: recentBank.map((t) => entityRow(`${day(t.posted_on)} · ${str(t.merchant) || str(t.name)} · ${num(t.amount) > 0 ? "-" : "+"}${usd(Math.abs(num(t.amount)))}`, "admin.bank_tx", t.id)),
        },
      ],
      links: [{ label: "Money", href: "/admin/payments" }, { label: "Transactions", href: "/admin/transactions" }],
    },
    {
      id: "users", label: "Users & permissions", kind: "admin", who: ["owner"], group: "a",
      blurb: `${n(profiles.length)} users · ${n(roleCounts.size)} roles in use`,
      title: "Users & permissions", sub: "Who can log in and what they can see.",
      blocks: [
        {
          t: "Users", v: n(profiles.length), d: `${n(profiles.filter((p) => !p.full_name).length)} have no name filled in`,
          rows: [...profiles].sort((a, b) => name(a.id).localeCompare(name(b.id))).map((p) => {
            const held = roles.filter((r) => r.profile_id === p.id).map((r) => str(r.role_name));
            return entityRow(`${name(p.id)} · ${held.join(", ") || "no role"}`, "admin.profile", p.id);
          }),
        },
        { t: "Roles in use", v: n(roleCounts.size), d: "How many people hold each role", rows: roleRows(roleCounts, "") },
        { t: "Page access rules", v: n(perms), d: "Role permissions defined today", rows: roleRows(pageRules, " pages") },
        {
          t: "Activity log", v: n(roleEdits), d: "Role edits logged",
          rows: editLog.map((e) => (e.role_name ? entityRow(`${day(e.at)} · ${str(e.actor_name) || "Somebody"} · ${str(e.action).replace(/_/g, " ")} · ${str(e.role_name)}`, "admin.role", e.role_name) : `${day(e.at)} · ${str(e.action)}`)),
        },
      ],
      links: [{ label: "Settings & permissions", href: "/admin/settings" }, { label: "View as", href: "/admin/view-as" }],
    },
    {
      id: "integrations", label: "Connection health", kind: "admin", who: ["owner"], group: "a",
      blurb: "GoHighLevel, Stripe, email, banks",
      title: "Connection health", sub: "When each connection last worked. Paste or fix logins under Integrations.",
      blocks: [
        {
          t: "GoHighLevel", v: sync ? (/[1-9]\d* failed/.test(str(sync.last_result)) ? "Errors" : "OK") : "—", d: sync ? `Last pull ${day(sync.last_pulled_at)} · ${str(sync.last_result)}` : "No sync on record",
          rows: [entityRow(`GoHighLevel · ${connection("gohighlevel")?.status ?? "open"}`, "admin.integration", "gohighlevel")],
        },
        {
          t: "Stripe payments", v: pay ? str(pay.state).toUpperCase() : "—", d: pay ? `Checked ${day(pay.checked_at)}` : "No check on record",
          rows: [entityRow(`Stripe · ${connection("stripe")?.status ?? "open"}`, "admin.integration", "stripe")],
        },
        { t: "Email sending", v: n(domains.length), d: "Sending domains", rows: domains.map((d) => entityRow(`${str(d.hostname)} · ${str(d.status)}`, "admin.integration", "resend")) },
        { t: "Banks", v: n(bankAcc), d: "Bank accounts connected", rows: [entityRow(`Plaid · ${connection("plaid")?.status ?? "open"}`, "admin.integration", "plaid")] },
        { t: "Post finder extension", v: n(finder), d: "Computers running it", rows: finders.map((f) => `${str(f.label) || "Computer"} · last seen ${day(f.last_seen_at)}`) },
      ],
      links: [{ label: "Settings", href: "/admin/settings" }],
    },
    {
      id: "company", label: "Business details", kind: "admin", who: ["owner"], group: "a",
      blurb: `${n(locations.length)} locations · ${n(services.length)} services`,
      title: "Business details", sub: "Your business, its locations, the services you sell, and your notifications.",
      blocks: [
        { t: "The business", v: "1", d: "Name, phone, email and address on every document", rows: orgId ? [entityRow("Business details", "admin.organization", orgId)] : [] },
        { t: "Locations", v: n(locations.length), d: "On file", rows: locations.map((l) => entityRow(`${str(l.name).slice(0, 40)} · ${str(l.address).split(",").slice(1, 2).join("").trim()}`, "admin.location", l.id)) },
        {
          t: "Services", v: n(services.length), d: [...svc.entries()].map(([k, v]) => `${v} ${k}`).join(" · ") + (dupes.length ? ` · duplicates: ${dupes.map(([k, v]) => `${k} ×${v}`).join(", ")}` : ""),
          rows: [...services]
            .sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || str(a.name).localeCompare(str(b.name)))
            .map((s) => entityRow(`${str(s.name) || str(s.service_type_id)} · ${str(s.status)}`, "admin.service", s.service_type_id)),
        },
        { t: "Service area", v: "1", d: "Harford County" },
        { t: "Your notifications", v: n(notifLog), d: notifPrefs ? "Sent to you · your preferences are set" : "Sent to you · no preferences set yet" },
        { t: "Documents & designs", v: n(designs), d: "Flyer and design files" },
      ],
      links: [{ label: "Organizations", href: "/admin/organizations" }, { label: "Settings", href: "/admin/settings" }, { label: "Team & services", href: "/admin/team" }],
    },
    {
      id: "managers", label: "Account managers", kind: "people", who: ["owner"], group: "b",
      blurb: `${n(ams.length)} account managers`,
      title: "Account managers", sub: "The people who oversee everything.",
      blocks: [
        { t: "Roster", v: n(ams.length), d: "People with the account manager role", rows: ams.map((id) => entityRow(`${name(id)} · ${n(jobs.filter((j) => j.assigned_to === id).length)} jobs assigned`, "admin.account_manager", id)) },
      ],
      links: [{ label: "Team & services", href: "/admin/team" }],
    },
    {
      id: "hiring", label: "Hiring", kind: "people", who: ["owner"], group: "b",
      blurb: `Account manager hiring · ${n(applicants.length)} recent applicants`,
      title: "Hiring", sub: "Hire account managers.",
      blocks: [
        { t: "Open positions", v: "0", d: "No account manager posting yet" },
        {
          t: "Applicants", v: n(applicants.length), d: "Newest first",
          rows: applicants.map((a) => entityRow(`${str(a.name)} · ${str(a.position).replace(/-/g, " ")} · ${str(a.stage).replace(/_/g, " ")} · ${day(a.created_at)}`, "admin.applicant", a.id)),
        },
      ],
      links: [{ label: "Hiring", href: "/admin/hiring" }],
    },
    {
      id: "tasks", label: "Old screens", kind: "admin", who: ["owner"], group: "a",
      blurb: "Old screens not moved over yet",
      title: "Old screens", sub: "Screens from the old app that have no place here yet.",
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
      overview("Admin overview", "Every department at a glance. Open any row to act on it.", [
        { t: "Marketing", v: n(cust30), d: "New contacts in 30 days", rows: newCustomers.map(customerRow) },
        { t: "Sales", v: pct(accepted, accepted + declined), d: `Close rate on answered proposals · ${usd(waiting)} waiting on clients`, rows: sentRows },
        { t: "Operations", v: n(approvedNotDone), d: "Approved jobs not finished", rows: approvedJobs.slice(0, 25).map((j) => entityRow(str(j.name) || "Job", "admin.job", j.id)) },
        { t: "Alerts", v: n(alerts.length), d: "Flagged right now", rows: alerts },
      ], [{ label: "Current admin page", href: "/admin" }, { label: "Dashboard", href: "/dashboard" }, { label: "Alerts", href: "/notifications" }]),
      ...pillars,
    ],
    loadedAt: stamp(),
  };
}

function overview(title: string, sub: string, blocks: V2Block[], links: V2Pillar["links"]): V2Pillar {
  return { id: "overview", label: "Overview", kind: "", who: ["owner"], title, sub, blocks, links };
}

/* ------------------------------------------------------------------ */
/* The few choices on each page                                        */
/* ------------------------------------------------------------------ */

type Group = {
  id: string; label: string; title: string; sub: string; ids: string[];
  /** Working screens shown above the numbers: keys into the panel registry. Owner only. */
  panels?: string[];
  /** A role's own home screen on this choice, for everybody who isn't the owner. */
  rolePanels?: Partial<Record<V2Role, string[]>>;
};

/**
 * Each page offers a handful of choices, not a dozen. The loaders still build
 * one pillar per job; these gather them, and a choice shows every job in it
 * one under another. A job left out of every group is never shown, so a test
 * checks that each one is placed.
 */
export const V2_GROUPS: Record<V2Section["key"], Group[]> = {
  marketing: [
    {
      id: "digital", label: "Digital marketing", title: "Digital marketing",
      sub: "The website, search, ads, social, email and the people sharing links.",
      ids: ["website", "seo", "social", "email", "comments", "affiliates"],
      panels: ["marketing-autopilot", "reviews"],
      rolePanels: { affiliate: ["affiliate-home"] },
    },
    {
      id: "physical", label: "Physical marketing", title: "Physical marketing",
      sub: "Door hangers, signs, flyers and mail, the lists they go to, and what paid off.",
      ids: ["print", "lists", "worked"],
      panels: ["physical-marketing"],
    },
  ],
  sales: [
    { id: "pipeline", label: "Pipeline", title: "Pipeline", sub: "Every opportunity, and the proposals that close it.", ids: ["pipeline", "proposals"], panels: ["pipeline-autopilot"], rolePanels: { "account-manager": ["am-sales"] } },
    { id: "evaluations", label: "Evaluations", title: "Evaluations", sub: "Visits, the proposals that come from them, and the people who do them.", ids: ["booking", "myevals", "evaluators"], panels: ["evaluator-scorecard", "territories"], rolePanels: { evaluator: ["evaluator-home"] } },
    { id: "messages", label: "Automated messages", title: "Automated messages", sub: "Every message that goes out on its own, and who is in each one right now.", ids: ["messages"], panels: ["client-messages", "email-approval-policy"] },
  ],
  operations: [
    { id: "projects", label: "Projects", title: "Projects", sub: "Scheduled, worked and closed out.", ids: ["scheduling", "projects", "closeout", "mylead", "mytech"], panels: ["projects-autopilot", "weather", "snow-ops"], rolePanels: { "project-lead": ["lead-home"], "project-technician": ["crew-home"] } },
    { id: "supplies", label: "Materials & equipment", title: "Materials & equipment", sub: "What the jobs use, and what the crews carry.", ids: ["materials", "equipment"], panels: ["purchasing", "equipment"] },
    { id: "messages", label: "Automated messages", title: "Automated messages", sub: "Every message about the work that goes out on its own, and who is in each one right now.", ids: ["opsmessages"] },
    { id: "team", label: "Team", title: "Team", sub: "The project team, and hiring the next one.", ids: ["team", "hiring"], panels: ["crew-budget"] },
  ],
  admin: [
    { id: "oversight", label: "Oversight", title: "Oversight", sub: "What's waiting on you, every department at a glance, and every customer.", ids: ["overview", "customers"], panels: ["approval-queue"], rolePanels: { "account-manager": ["am-accounts"] } },
    { id: "finance", label: "Finance", title: "Finance", sub: "Money in and money out, against target.", ids: ["finance"], panels: ["finance", "job-costing", "commissions"] },
    { id: "people", label: "Team & access", title: "Team & access", sub: "Who can use the app, and the managers.", ids: ["users", "managers", "hiring"], panels: ["people"] },
    { id: "settings", label: "Settings", title: "Settings", sub: "Logins for outside services, licences and deadlines, and your business details.", ids: ["integrations", "company"], panels: ["integrations", "compliance"] },
    { id: "tasks", label: "Task list", title: "Task list", sub: "Your shared to-do list.", ids: ["tasks"], panels: ["task-list"] },
  ],
};

export function condense(section: V2Section): V2Section {
  const byId = new Map(section.pillars.map((p) => [p.id, p]));
  const pillars = V2_GROUPS[section.key].flatMap((g): V2Pillar[] => {
    const parts = g.ids.map((id) => byId.get(id)).filter((p): p is V2Pillar => Boolean(p));
    if (!parts.length && !g.rolePanels) return [];
    return [{
      id: g.id, label: g.label, title: g.title, sub: g.sub,
      kind: parts.find((p) => p.kind)?.kind ?? "",
      who: [...new Set([...parts.flatMap((p) => p.who), ...(Object.keys(g.rolePanels ?? {}) as V2Role[])])],
      blurb: parts.map((p) => p.label).join(" · "),
      blocks: [], links: [], parts, panels: g.panels, rolePanels: g.rolePanels,
    }];
  });
  return { ...section, pillars };
}

const condensed = (load: (viewerId?: string | null) => Promise<V2Section>) => async (viewerId: string | null = null) =>
  condense(await load(viewerId));

export const V2_LOADERS = {
  marketing: condensed(loadMarketing),
  sales: condensed(loadSales),
  operations: condensed(loadOperations),
  admin: condensed(loadAdmin),
} as const;

/**
 * A page cut down to what these roles may see, before it leaves the server.
 * The shell hides what a role doesn't get, but hiding isn't enough: anything
 * handed to the browser can be read there. The owner gets the page as is.
 */
export function v2ForViewer(section: V2Section, roles: V2Role[]): V2Section {
  if (roles.includes("owner")) return section;
  const sees = (p: V2Pillar) => p.who.some((r) => roles.includes(r));
  const hasHome = (p: V2Pillar) => roles.some((r) => (p.rolePanels?.[r] ?? []).length > 0);
  const pillars = section.pillars
    .filter((p) => sees(p) || hasHome(p))
    .map((p): V2Pillar => {
      const parts = p.parts?.filter(sees);
      // Kept only for a role's home screen: none of the choice's own numbers go with it.
      if (!sees(p)) return { ...p, blocks: [], links: [], automations: undefined, parts: parts ?? [], panels: undefined };
      return { ...p, parts, panels: undefined, blurb: parts ? parts.map((x) => x.label).join(" · ") : p.blurb };
    });
  const showsWebsite = pillars.some((p) => [p, ...(p.parts ?? [])].some((x) => x.view === "website" && sees(x)));
  return { ...section, pillars, website: showsWebsite ? section.website : undefined };
}
