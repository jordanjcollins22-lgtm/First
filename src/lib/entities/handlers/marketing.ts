import type { ActionResult, EntityAction, EntityContext, EntityField, EntityHandler } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import {
  campaignMoves,
  centsText,
  clip,
  dateText,
  easternMorning,
  flyerRunMoves,
  mailingMoves,
  parsePageId,
  parseRate,
  playMoves,
  pmMoves,
  postMoves,
  PROSPECT_STATUSES,
  prospectMoves,
  RECIPIENT_STATUSES,
  reviewMoves,
  statusLabel,
  whenText,
  type ProspectStatus,
} from "@/lib/entities/marketing-rules";
import { setCampaignStatus, startCampaign } from "@/lib/actions/campaign-actions";
import { setEddmMailingStatus } from "@/lib/actions/eddm-mailing-actions";
import { removeBookingFromRun } from "@/lib/actions/flyer-run-actions";
import {
  approveReviewReply,
  assignPlayTo,
  draftReplyNow,
  markPlayDone,
  skipPlay,
  skipReviewReply,
} from "@/lib/actions/marketing-autopilot-actions";
import { approveMarketingPlay } from "@/lib/actions/marketing-actions";
import { setAffiliate } from "@/lib/actions/affiliate-actions";
import { updateProfilePay } from "@/lib/actions/team-actions";
import { markCompany, rewriteSequence, savePmSettings, saveSequence, setCompanyEmail } from "@/lib/actions/pm-outreach-actions";
import { archiveGroup, markPassUsed, markPostHandled, saveGroup } from "@/lib/actions/community-group-actions";
import { markPosted, reschedulePost } from "@/lib/actions/social-actions";
import { skipPlanPost } from "@/lib/actions/social-plan-actions";
import { recordPostedComment, recordResponse } from "@/lib/actions/outreach-link-actions";
import { setDoNotContact, setProspectStatus } from "@/lib/actions/prospect-actions";
import { markMowCalled } from "@/lib/actions/mow-order-actions";
import { publishWebsite } from "@/lib/actions/website-actions";
import { getIntegration } from "@/lib/integrations/store";
import { canPublishToFacebook, publishPhotoToPage } from "@/lib/social/facebook";
import { outboundBaseUrl } from "@/lib/base-url";
import { RESPONSES, trackedLink, type OutreachResponse } from "@/lib/outreach-links";
import { KIND_LABEL, REASON_LABEL, type PlayKind, type PlayReason } from "@/lib/marketing-plays";
import { areaSlug, normalizeWebsite, type WebsiteContent } from "@/lib/website";

/**
 * What can be opened and done from the Marketing page's lists: campaigns and
 * their recipients, mailings, flyer runs, plays, affiliates, property
 * managers, groups, posts, outreach links, prospects, Google reviews, orders
 * and the website's pages.
 *
 * Every read is scoped to the owner's business. Every change goes through
 * the server action the old screens already use, so the rules (one open
 * flyer run, a campaign's domain readiness, a play's closing stamp) are the
 * same wherever it is pressed.
 */

// Tables here range wider than the generated types (google_reviews,
// website_settings, the plays' closing columns); rows are read loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const s = (x: unknown) => (typeof x === "string" ? x : "");
const num = (x: unknown) => (typeof x === "number" ? x : Number(x ?? 0) || 0);
const n = (x: number) => x.toLocaleString("en-US");

async function one(ctx: EntityContext, table: string, cols: string, id: string): Promise<Row | null> {
  const { data } = await ctx.sb.from(table).select(cols).eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
  return (data as Row | null) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function many(ctx: EntityContext, table: string, cols: string, filter: (q: any) => any): Promise<Row[]> {
  const { data, error } = await filter(ctx.sb.from(table).select(cols).eq("organization_id", ctx.organizationId));
  return error ? [] : ((data ?? []) as Row[]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tally(ctx: EntityContext, table: string, filter: (q: any) => any): Promise<number> {
  const { count } = await filter(ctx.sb.from(table).select("*", { count: "exact", head: true }).eq("organization_id", ctx.organizationId));
  return count ?? 0;
}

/** Jobs carry no organization of their own: they belong through property and client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jobsOf(ctx: EntityContext, cols: string, filter: (q: any) => any): Promise<Row[]> {
  const { data, error } = await filter(
    ctx.sb
      .from("jobs")
      .select(`${cols}, property:properties!inner(customer:customers!inner(organization_id))`)
      .eq("property.customer.organization_id", ctx.organizationId)
  );
  return error ? [] : ((data ?? []) as Row[]);
}

/** Whatever shape an existing action answers in, as the drawer's. */
function result(r: { ok: boolean; error?: string; message?: string }, okMessage?: string): ActionResult {
  return r.ok ? { ok: true, message: r.message || okMessage } : { ok: false, error: r.error || r.message || "That didn't work." };
}

const gone: ActionResult = { ok: false, error: "It isn't there any more." };
const unknown: ActionResult = { ok: false, error: "That can't be done here." };

async function personName(ctx: EntityContext, id: unknown): Promise<string> {
  if (typeof id !== "string" || !id) return "Nobody";
  const p = await one(ctx, "profiles", "full_name, email", id);
  return p ? s(p.full_name) || s(p.email) || "Someone" : "Someone";
}

function f(label: string, value: unknown): EntityField {
  return { label, value: value == null ? "" : String(value) };
}

/* ------------------------------------------------------------------ */
/* Email campaigns                                                     */
/* ------------------------------------------------------------------ */

const campaign: EntityHandler = {
  kind: "mkt.campaign",
  async load(ctx, id) {
    const c = await one(ctx, "email_campaigns", "id, name, status, service_label, offer_cents, code_expires_on, paused_reason, started_at, finished_at, created_at", id);
    if (!c) return null;
    const recipients = await many(ctx, "email_campaign_recipients", "id, name, email, status, opened_at, clicked_at, booked_at, sent_at, created_at", (q) =>
      q.eq("campaign_id", id).order("created_at", { ascending: false }).limit(2000)
    );
    const by = (st: string) => recipients.filter((r) => r.status === st);
    const opened = recipients.filter((r) => r.opened_at).length;
    const clicked = recipients.filter((r) => r.clicked_at).length;
    const booked = recipients.filter((r) => r.booked_at).length;
    const recipientRow = (r: Row) =>
      row(
        `${s(r.name) || s(r.email)}${r.booked_at ? " · booked" : r.clicked_at ? " · clicked" : r.opened_at ? " · opened" : ""}`,
        "mkt.campaign_recipient",
        r.id
      );
    const actions: EntityAction[] = campaignMoves(s(c.status)).map((m) =>
      m === "start"
        ? { id: "start", label: "Start sending", tone: "primary", confirm: "Start this campaign? Everyone on its list is queued and the first batch goes on the next daily run." }
        : m === "pause"
          ? { id: "pause", label: "Pause" }
          : m === "resume"
            ? { id: "resume", label: "Resume", tone: "primary" }
            : { id: "stop", label: "Stop for good", tone: "danger", confirm: "Stop this campaign? Nobody else on its list will be emailed." }
    );
    return {
      title: s(c.name),
      subtitle: s(c.service_label),
      status: statusLabel(s(c.status)),
      fields: [
        f("Offer", centsText(num(c.offer_cents))),
        f("Code expires", dateText(s(c.code_expires_on))),
        f("Started", dateText(s(c.started_at))),
        ...(c.finished_at ? [f("Finished", dateText(s(c.finished_at)))] : []),
        ...(c.paused_reason ? [f("Paused because", s(c.paused_reason))] : []),
        f("Recipients", n(recipients.length)),
        f("Sent", n(by("sent").length)),
        f("Opened · clicked · booked", `${n(opened)} · ${n(clicked)} · ${n(booked)}`),
      ],
      // Every status anyone is in, plus queued and sent even when empty.
      sections: RECIPIENT_STATUSES.filter((st) => st === "queued" || st === "sent" || by(st).length > 0).map((st) => ({
        title: `${statusLabel(st)} (${n(by(st).length)})`,
        rows: by(st).slice(0, 25).map(recipientRow),
        empty: "Nobody.",
      })),
      actions,
      note: c.status === "done" ? "This campaign has finished." : "The daily run sends a few at a time and stops itself on bounces or complaints.",
    };
  },
  async act(ctx, id, action) {
    const c = await one(ctx, "email_campaigns", "id, status", id);
    if (!c) return gone;
    if (!campaignMoves(s(c.status)).includes(action as never)) return { ok: false, error: "That can't be done to a campaign that is " + s(c.status) + "." };
    if (action === "start") return result(await startCampaign(id));
    if (action === "pause") return result(await setCampaignStatus(id, "paused"), "Paused.");
    if (action === "resume") return result(await setCampaignStatus(id, "running"), "Sending again on the next run.");
    if (action === "stop") return result(await setCampaignStatus(id, "done"), "Stopped.");
    return unknown;
  },
};

/** id: a campaign status, or "all". */
const campaignList: EntityHandler = {
  kind: "mkt.campaign_list",
  async load(ctx, id) {
    const list = await many(ctx, "email_campaigns", "id, name, status, service_label, started_at, created_at", (q) => (id === "all" ? q : q.eq("status", id)).order("created_at", { ascending: false }).limit(40));
    return {
      title: id === "all" ? "Email campaigns" : `Email campaigns: ${statusLabel(id).toLowerCase()}`,
      subtitle: `${n(list.length)}`,
      fields: [],
      sections: [{ title: "Newest first", rows: list.map((c) => row(`${s(c.name)} · ${s(c.service_label)} · ${statusLabel(s(c.status))}`, "mkt.campaign", c.id)), empty: "None." }],
      actions: [],
      note: "Open one to start, pause, resume or stop it.",
    };
  },
};

const campaignRecipient: EntityHandler = {
  kind: "mkt.campaign_recipient",
  async load(ctx, id) {
    const r = await one(ctx, "email_campaign_recipients", "id, campaign_id, name, email, code, status, skip_reason, sent_at, opened_at, clicked_at, booked_at, price_cents, lawn_sqft", id);
    if (!r) return null;
    const c = await one(ctx, "email_campaigns", "id, name", s(r.campaign_id));
    return {
      title: s(r.name) || s(r.email),
      subtitle: s(r.email),
      status: statusLabel(s(r.status)),
      fields: [
        f("Code", s(r.code)),
        ...(r.skip_reason ? [f("Skipped because", s(r.skip_reason))] : []),
        f("Sent", whenText(s(r.sent_at))),
        f("Opened", whenText(s(r.opened_at))),
        f("Clicked", whenText(s(r.clicked_at))),
        f("Booked", whenText(s(r.booked_at))),
        ...(r.price_cents ? [f("Price quoted", centsText(num(r.price_cents)))] : []),
      ],
      sections: c ? [{ title: "Campaign", rows: [row(s(c.name), "mkt.campaign", c.id)] }] : [],
      actions: r.status === "queued" ? [{ id: "skip", label: "Take off the list", tone: "danger", confirm: "Take this person off the campaign? They won't be emailed." }] : [],
    };
  },
  async act(ctx, id, action) {
    if (action !== "skip") return unknown;
    const { error } = await ctx.sb
      .from("email_campaign_recipients")
      .update({ status: "skipped", skip_reason: "Taken off by hand." })
      .eq("id", id)
      .eq("organization_id", ctx.organizationId)
      .eq("status", "queued");
    return error ? { ok: false, error: error.message } : { ok: true, message: "Taken off the list." };
  },
};

/* ------------------------------------------------------------------ */
/* Mail and flyers                                                     */
/* ------------------------------------------------------------------ */

const mailing: EntityHandler = {
  kind: "mkt.mailing",
  async load(ctx, id) {
    const m = await one(ctx, "eddm_mailings", "id, name, audience, routes, pieces, postage_cents, print_cost_cents, status, mailed_on, created_at", id);
    if (!m) return null;
    const plays = await many(ctx, "marketing_plays", "id, kind, quantity, status", (q) => q.eq("mailing_id", id).limit(25));
    const routes = Array.isArray(m.routes) ? (m.routes as Row[]) : [];
    const actions: EntityAction[] = mailingMoves(s(m.status)).map((st) =>
      st === "mailed"
        ? { id: "mailed", label: "Mark mailed", tone: "primary", input: { type: "date", label: "Day it went to the post office", initial: new Date().toISOString().slice(0, 10) } }
        : { id: st, label: st === "printed" ? "Mark printed" : "Back to planned" }
    );
    return {
      title: s(m.name),
      subtitle: `Every-door mail · ${s(m.audience) === "all" ? "every address" : "homes only"}`,
      status: statusLabel(s(m.status)),
      fields: [
        f("Pieces", n(num(m.pieces))),
        f("Postage", centsText(num(m.postage_cents))),
        f("Printing", centsText(num(m.print_cost_cents))),
        f("Total", centsText(num(m.postage_cents) + num(m.print_cost_cents))),
        f("Mailed", dateText(s(m.mailed_on))),
        f("Made", dateText(s(m.created_at))),
      ],
      sections: [
        { title: `USPS routes (${n(routes.length)})`, rows: routes.slice(0, 25).map((r) => ({ text: `${s(r.zip)} ${s(r.routeId)}${r.total != null ? ` · ${n(num(r.total))} addresses` : ""}` })) },
        { title: "Plays it mails for", rows: plays.map((p) => row(`${KIND_LABEL[p.kind as PlayKind] ?? p.kind} · ${n(num(p.quantity))} · ${s(p.status)}`, "mkt.play", p.id)), empty: "Made by hand, not from a play." },
      ],
      actions,
    };
  },
  async act(ctx, id, action, value) {
    const m = await one(ctx, "eddm_mailings", "id, status", id);
    if (!m) return gone;
    if (action !== "planned" && action !== "printed" && action !== "mailed") return unknown;
    if (action === "mailed" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: "Pick a day." };
    const r = await setEddmMailingStatus(id, action, action === "mailed" ? value || null : null);
    return result(r, `Marked ${action}.`);
  },
};

const flyerRun: EntityHandler = {
  kind: "mkt.flyer_run",
  async load(ctx, id) {
    const r = await one(ctx, "flyer_runs", "id, name, mails_on, flyer_count, spot_price_cents, status, created_at", id);
    if (!r) return null;
    const bookings = await many(ctx, "flyer_bookings", "id, business_name, status, slot, amount_cents, paid_at", (q) => q.eq("run_id", id).order("slot", { ascending: true, nullsFirst: false }).limit(50));
    const paid = bookings.filter((b) => b.paid_at || b.status === "paid");
    const actions: EntityAction[] = [
      ...flyerRunMoves(s(r.status)).map(
        (st): EntityAction =>
          st === "open"
            ? { id: "open", label: "Open for bookings", tone: "primary", confirm: "Open this run? Any other open run is closed, because the public link sells the open one." }
            : st === "closed"
              ? { id: "closed", label: "Stop taking bookings" }
              : { id: "printed", label: "Mark printed" }
      ),
      { id: "date", label: "Set mail day", input: { type: "date", label: "Day it goes to the post office", initial: s(r.mails_on) } },
    ];
    return {
      title: s(r.name),
      subtitle: "Shared flyer run",
      status: statusLabel(s(r.status)),
      fields: [
        f("Mails on", dateText(s(r.mails_on))),
        f("Flyers", n(num(r.flyer_count))),
        f("Price a square", centsText(num(r.spot_price_cents))),
        f("Squares booked", `${n(bookings.length)} (${n(paid.length)} paid)`),
        f("Taken in", centsText(paid.reduce((a, b) => a + num(b.amount_cents), 0))),
      ],
      sections: [
        {
          title: "Advertisers",
          rows: bookings.map((b) => row(`${b.slot ? `Square ${b.slot} · ` : ""}${s(b.business_name)} · ${statusLabel(s(b.status))}`, "mkt.flyer_booking", b.id)),
          empty: "No squares booked yet.",
        },
      ],
      actions,
    };
  },
  async act(ctx, id, action, value) {
    const r = await one(ctx, "flyer_runs", "id, status", id);
    if (!r) return gone;
    // The old screen's action is admin-only; the owner has the same rule here:
    // one open run at a time, because the public link sells "the open run".
    if (action === "open" || action === "closed" || action === "printed") {
      if (action === "open") {
        await ctx.sb.from("flyer_runs").update({ status: "closed" }).eq("organization_id", ctx.organizationId).eq("status", "open");
      }
      const { error } = await ctx.sb.from("flyer_runs").update({ status: action, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ctx.organizationId);
      return error ? { ok: false, error: error.message } : { ok: true, message: action === "open" ? "Open, and the link sells this run." : `Marked ${action}.` };
    }
    if (action === "date") {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: "Pick a day." };
      const { error } = await ctx.sb.from("flyer_runs").update({ mails_on: value || null, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ctx.organizationId);
      return error ? { ok: false, error: error.message } : { ok: true, message: value ? `Mails on ${dateText(value)}.` : "Mail day cleared." };
    }
    return unknown;
  },
};

const flyerBooking: EntityHandler = {
  kind: "mkt.flyer_booking",
  async load(ctx, id) {
    const b = await one(ctx, "flyer_bookings", "id, run_id, business_name, contact_name, email, phone, artwork_kind, status, slot, amount_cents, paid_at, created_at", id);
    if (!b) return null;
    const run = await one(ctx, "flyer_runs", "id, name", s(b.run_id));
    return {
      title: s(b.business_name),
      subtitle: s(b.contact_name),
      status: statusLabel(s(b.status)),
      fields: [f("Square", b.slot ?? "Not placed"), f("Email", s(b.email)), f("Phone", s(b.phone)), f("Artwork", statusLabel(s(b.artwork_kind))), f("Paid", b.paid_at ? `${centsText(num(b.amount_cents))} on ${dateText(s(b.paid_at))}` : "Not yet"), f("Booked", dateText(s(b.created_at)))],
      sections: run ? [{ title: "Run", rows: [row(s(run.name), "mkt.flyer_run", run.id)] }] : [],
      actions: [{ id: "remove", label: "Take off the run", tone: "danger", confirm: "Take this advertiser off the run? Any payment is not refunded from here." }],
    };
  },
  async act(ctx, id, action) {
    if (action !== "remove") return unknown;
    if (!(await one(ctx, "flyer_bookings", "id", id))) return gone;
    return result(await removeBookingFromRun(id), "Taken off the run.");
  },
};

/* ------------------------------------------------------------------ */
/* Plays                                                               */
/* ------------------------------------------------------------------ */

async function teamOptions(ctx: EntityContext) {
  const people = await many(ctx, "profiles", "id, full_name, email, is_affiliate", (q) => q.order("full_name").limit(200));
  return people.map((p) => ({ value: s(p.id), label: `${s(p.full_name) || s(p.email)}${p.is_affiliate ? " (affiliate)" : ""}` }));
}

const play: EntityHandler = {
  kind: "mkt.play",
  async load(ctx, id) {
    const p = await one(ctx, "marketing_plays", "id, house_id, customer_id, mailing_id, reason, kind, quantity, status, approval, assigned_to, assigned_at, done_at, note, closed_reason, closed_note, cost_cents, created_at", id);
    if (!p) return null;
    const [house, customer, assignee, options] = await Promise.all([
      p.house_id ? one(ctx, "houses", "address", s(p.house_id)) : Promise.resolve(null),
      p.customer_id ? one(ctx, "customers", "id, name", s(p.customer_id)) : Promise.resolve(null),
      personName(ctx, p.assigned_to),
      teamOptions(ctx),
    ]);
    const moves = playMoves({ status: s(p.status), approval: s(p.approval) || null });
    const actions: EntityAction[] = [];
    if (moves.includes("approve")) actions.push({ id: "approve", label: "Approve", tone: "primary" });
    if (moves.includes("assign"))
      actions.push({ id: "assign", label: "Give it to", input: { type: "select", label: "Who walks it", options: [{ value: "nobody", label: "Nobody" }, ...options], initial: s(p.assigned_to) } });
    if (moves.includes("done")) actions.push({ id: "done", label: "Mark done", confirm: "Mark this play done? It is costed and closed." });
    if (moves.includes("skip"))
      actions.push({ id: "skip", label: "Skip it", tone: "danger", confirm: "Skip this play for good?", input: { type: "text", label: "Why (optional)", placeholder: "Too far out" } });
    return {
      title: `${KIND_LABEL[p.kind as PlayKind] ?? s(p.kind)} · ${n(num(p.quantity))}`,
      subtitle: house ? s(house.address) : undefined,
      status: p.status === "open" ? (moves.includes("approve") ? "Waiting for approval" : "Ready to go") : statusLabel(s(p.status)),
      fields: [
        f("Why", REASON_LABEL[p.reason as PlayReason] ?? s(p.reason)),
        f("Client", customer ? s(customer.name) : ""),
        f("Given to", assignee),
        f("Made", dateText(s(p.created_at))),
        ...(p.done_at ? [f("Closed", dateText(s(p.done_at)))] : []),
        ...(p.closed_note ? [f("Closed because", s(p.closed_note))] : []),
        ...(p.cost_cents != null ? [f("Cost", centsText(num(p.cost_cents)))] : []),
        ...(p.note ? [f("Note", s(p.note))] : []),
      ],
      sections: p.mailing_id ? [{ title: "Mailing", rows: [row("The EDDM mailing for these flyers", "mkt.mailing", p.mailing_id)] }] : [],
      actions,
      note: p.status === "open" ? "A play also closes itself when walked, when the crew finishes the job, or after a month of nothing." : undefined,
    };
  },
  async act(ctx, id, action, value) {
    const p = await one(ctx, "marketing_plays", "id, status, approval", id);
    if (!p) return gone;
    if (!playMoves({ status: s(p.status), approval: s(p.approval) || null }).includes(action as never)) return { ok: false, error: "This play is already closed." };
    if (action === "approve") return result(await approveMarketingPlay(id), "Approved.");
    if (action === "assign") return result(await assignPlayTo(id, !value || value === "nobody" ? null : value), value && value !== "nobody" ? "Given to them." : "Taken back.");
    if (action === "done") return result(await markPlayDone(id), "Marked done.");
    if (action === "skip") return result(await skipPlay(id, value?.trim() || null), "Skipped.");
    return unknown;
  },
};

/** id: a play kind, "pending", or "unassigned". Open plays only. */
const playList: EntityHandler = {
  kind: "mkt.play_list",
  async load(ctx, id) {
    const all = await many(ctx, "marketing_plays", "id, house_id, kind, quantity, approval, assigned_to, created_at", (q) => q.eq("status", "open").order("created_at", { ascending: false }).limit(1000));
    const list = all.filter((p) =>
      id === "pending" ? !p.approval || p.approval === "pending" : id === "unassigned" ? !p.assigned_to && p.approval !== "pending" : p.kind === id
    );
    const houses = await many(ctx, "houses", "id, address", (q) => q.in("id", [...new Set(list.slice(0, 50).map((p) => s(p.house_id)))].filter(Boolean)));
    const where = (hid: unknown) => s(houses.find((h) => h.id === hid)?.address).split(",")[0] || "—";
    const title = id === "pending" ? "Plays waiting for approval" : id === "unassigned" ? "Approved plays nobody has" : `Open plays: ${KIND_LABEL[id as PlayKind] ?? id}`;
    return {
      title,
      subtitle: `${n(list.length)} open`,
      fields: [],
      sections: [
        {
          title: list.length > 50 ? "The newest 50" : "Newest first",
          rows: list.slice(0, 50).map((p) => row(`${KIND_LABEL[p.kind as PlayKind] ?? p.kind} · ${n(num(p.quantity))} · ${where(p.house_id)} · made ${dateText(s(p.created_at))}`, "mkt.play", p.id)),
          empty: "None open.",
        },
      ],
      actions: [],
      note: "Open one to approve it, give it to somebody, mark it done or skip it.",
    };
  },
};

/* ------------------------------------------------------------------ */
/* Affiliates                                                          */
/* ------------------------------------------------------------------ */

const affiliate: EntityHandler = {
  kind: "mkt.affiliate",
  async load(ctx, id) {
    const p = await one(ctx, "profiles", "id, full_name, email, phone, is_affiliate, affiliate_slug, commission_pct, pay_type", id);
    if (!p) return null;
    const [links, jobs, advances] = await Promise.all([
      many(ctx, "outreach_links", "id, platform, kind, click_count, created_at, comment, posted_comment", (q) => q.eq("profile_id", id).order("created_at", { ascending: false }).limit(200)),
      jobsOf(ctx, "id, name, status, created_at", (q) => q.eq("referred_by_profile_id", id).order("created_at", { ascending: false }).limit(50)),
      many(ctx, "commission_advances", "id, amount, status, requested_at", (q) => q.eq("profile_id", id).order("requested_at", { ascending: false }).limit(10)),
    ]);
    const clicks = links.reduce((a, l) => a + num(l.click_count), 0);
    return {
      title: s(p.full_name) || s(p.email),
      subtitle: p.is_affiliate ? "Affiliate" : "Not an affiliate now",
      status: p.commission_pct == null ? "Rate not set" : `${p.commission_pct}%`,
      fields: [
        f("Code", s(p.affiliate_slug)),
        f("Email", s(p.email)),
        f("Phone", s(p.phone)),
        f("Commission", p.commission_pct == null ? "Not set" : `${p.commission_pct}% of each project`),
        f("Links shared", n(links.length)),
        f("Clicks", n(clicks)),
        f("Projects referred", n(jobs.length)),
      ],
      sections: [
        { title: "Referred projects", rows: jobs.slice(0, 25).map((j) => row(`${s(j.name)} · ${statusLabel(s(j.status))} · ${dateText(s(j.created_at))}`, "mkt.referred_job", j.id)), empty: "None yet." },
        {
          title: "Links",
          rows: links.slice(0, 25).map((l) => row(`${dateText(s(l.created_at))} · ${s(l.platform)} · ${n(num(l.click_count))} clicks${l.posted_comment || l.comment ? ` — ${clip(s(l.posted_comment) || s(l.comment), 60)}` : ""}`, "mkt.outreach_link", l.id)),
          empty: "No links shared yet.",
        },
        { title: "Commission advances", rows: advances.map((a) => ({ text: `${dateText(s(a.requested_at))} · $${n(num(a.amount))} · ${statusLabel(s(a.status))}` })), empty: "None." },
      ],
      actions: [
        { id: "rate", label: "Set rate", tone: "primary", input: { type: "number", label: "Commission, % of each project", initial: p.commission_pct == null ? "" : String(p.commission_pct), placeholder: "10" } },
        p.is_affiliate
          ? { id: "remove", label: "Stop as affiliate", tone: "danger", confirm: "Stop them as an affiliate? Links already shared keep working, they just stop being offered." }
          : { id: "add", label: "Make an affiliate" },
      ],
    };
  },
  async act(ctx, id, action, value) {
    const p = await one(ctx, "profiles", "id, pay_type, pay_rate_per_hour", id);
    if (!p) return gone;
    if (action === "rate") {
      const rate = parseRate(value);
      if (rate === "bad") return { ok: false, error: "Enter a rate between 0 and 100." };
      // Hourly pay stays as it is; a rate makes them commission (or both).
      const payType = rate == null ? (s(p.pay_type) === "commission" ? "commission" : s(p.pay_type) || "hourly") : s(p.pay_type) === "hourly" ? "both" : s(p.pay_type) || "commission";
      try {
        await updateProfilePay(id, payType as "hourly" | "commission" | "both", p.pay_rate_per_hour ?? null, rate);
        return { ok: true, message: rate == null ? "Rate cleared." : `Rate set to ${rate}%.` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Couldn't set the rate." };
      }
    }
    if (action === "remove" || action === "add") return result(await setAffiliate(id, action === "add"), action === "add" ? "Now an affiliate, with a link." : "No longer an affiliate.");
    return unknown;
  },
};

const referredJob: EntityHandler = {
  kind: "mkt.referred_job",
  async load(ctx, id) {
    const [j] = await jobsOf(ctx, "id, name, status, created_at, completed_at, cancelled_at, referred_by_profile_id, referral_code", (q) => q.eq("id", id));
    if (!j) return null;
    const by = await personName(ctx, j.referred_by_profile_id);
    return {
      title: s(j.name),
      subtitle: `Referred by ${by}`,
      status: statusLabel(s(j.status)),
      fields: [f("Code used", s(j.referral_code)), f("Booked", dateText(s(j.created_at))), f("Finished", dateText(s(j.completed_at))), ...(j.cancelled_at ? [f("Cancelled", dateText(s(j.cancelled_at)))] : [])],
      sections: j.referred_by_profile_id ? [{ title: "Affiliate", rows: [row(by, "mkt.affiliate", j.referred_by_profile_id)] }] : [],
      actions: [],
      note: "The project itself is run from Sales and Operations; the affiliate's commission is paid from Admin › Finance.",
    };
  },
};

/* ------------------------------------------------------------------ */
/* Property managers                                                   */
/* ------------------------------------------------------------------ */

const pmCompany: EntityHandler = {
  kind: "mkt.pm_company",
  async load(ctx, id) {
    const c = await one(ctx, "pm_companies", "id, name, website, phone, address, contact_name, email, status, note, last_error, replied_at, last_reply, created_at", id);
    if (!c) return null;
    const emails = await many(ctx, "pm_emails", "id, step, subject, status, send_after, sent_at", (q) => q.eq("company_id", id).order("step"));
    const moves = pmMoves({ status: s(c.status), email: s(c.email) || null, hasDrafts: emails.some((e) => e.status === "draft") });
    const actions: EntityAction[] = [];
    if (moves.includes("approve")) actions.push({ id: "approve", label: "Approve the emails", tone: "primary", confirm: "Approve these emails as written? The first goes in the next sending window." });
    if (moves.includes("set_email"))
      actions.push({ id: "set_email", label: "Save address", input: { type: "email", label: "Email to write to", initial: s(c.email), placeholder: "manager@company.com", required: true } });
    if (moves.includes("rewrite")) actions.push({ id: "rewrite", label: "Write them again", confirm: "Throw these emails away and have them written again on the next run?" });
    if (moves.includes("interested")) actions.push({ id: "interested", label: "Interested" });
    if (moves.includes("not_interested")) actions.push({ id: "not_interested", label: "Not interested", confirm: "Mark not interested? No more emails go to them." });
    if (moves.includes("do_not_contact")) actions.push({ id: "do_not_contact", label: "Stop: never contact", tone: "danger", confirm: "Never contact this company again?" });
    return {
      title: s(c.name),
      subtitle: s(c.contact_name) || s(c.website),
      status: statusLabel(s(c.status)),
      fields: [
        f("Email", s(c.email)),
        f("Phone", s(c.phone)),
        f("Website", s(c.website)),
        f("Address", s(c.address)),
        ...(c.replied_at ? [f("Replied", dateText(s(c.replied_at))), f("Their reply", clip(s(c.last_reply), 300))] : []),
        ...(c.last_error ? [f("Problem", s(c.last_error))] : []),
        f("Found", dateText(s(c.created_at))),
      ],
      sections: [
        {
          title: "Emails",
          rows: emails.map((e) => row(`${e.step}. ${clip(s(e.subject), 60)} · ${statusLabel(s(e.status))}${e.sent_at ? ` ${dateText(s(e.sent_at))}` : e.send_after ? ` for ${dateText(s(e.send_after))}` : ""}`, "mkt.pm_email", e.id)),
          empty: "Not written yet. They are written on the next run once there is an address.",
        },
      ],
      actions,
    };
  },
  async act(ctx, id, action, value) {
    const c = await one(ctx, "pm_companies", "id, status, email, contact_name", id);
    if (!c) return gone;
    if (action === "approve") {
      const emails = await many(ctx, "pm_emails", "id, subject, body, status", (q) => q.eq("company_id", id).in("status", ["draft", "scheduled"]).order("step"));
      return result(await saveSequence({ companyId: id, emails: emails.map((e) => ({ id: s(e.id), subject: s(e.subject), body: s(e.body) })), approve: true }));
    }
    if (action === "set_email") return result(await setCompanyEmail(id, value ?? "", s(c.contact_name)));
    if (action === "rewrite") return result(await rewriteSequence(id));
    if (action === "interested" || action === "not_interested" || action === "do_not_contact") return result(await markCompany(id, action));
    return unknown;
  },
};

const pmEmail: EntityHandler = {
  kind: "mkt.pm_email",
  async load(ctx, id) {
    const e = await one(ctx, "pm_emails", "id, company_id, step, subject, body, status, send_after, sent_at, error", id);
    if (!e) return null;
    const c = await one(ctx, "pm_companies", "id, name", s(e.company_id));
    return {
      title: s(e.subject),
      subtitle: c ? `Email ${e.step} to ${s(c.name)}` : `Email ${e.step}`,
      status: statusLabel(s(e.status)),
      fields: [f("Sends", whenText(s(e.send_after))), f("Sent", whenText(s(e.sent_at))), ...(e.error ? [f("Problem", s(e.error))] : []), f("Body", s(e.body))],
      sections: c ? [{ title: "Company", rows: [row(s(c.name), "mkt.pm_company", c.id)] }] : [],
      actions: e.status === "draft" || e.status === "scheduled" ? [{ id: "skip", label: "Don't send this one", tone: "danger", confirm: "Skip this email? The others still go." }] : [],
    };
  },
  async act(ctx, id, action) {
    if (action !== "skip") return unknown;
    const { error } = await ctx.sb.from("pm_emails").update({ status: "skipped" }).eq("id", id).eq("organization_id", ctx.organizationId).in("status", ["draft", "scheduled"]);
    return error ? { ok: false, error: error.message } : { ok: true, message: "It won't be sent." };
  },
};

/** id: a pm_companies status, or "all". */
const pmList: EntityHandler = {
  kind: "mkt.pm_list",
  async load(ctx, id) {
    const [list, settings] = await Promise.all([
      many(ctx, "pm_companies", "id, name, status, email, updated_at", (q) => (id === "all" ? q : q.eq("status", id)).order("updated_at", { ascending: false }).limit(50)),
      pmSettings(ctx),
    ]);
    const sending = Boolean(settings?.sending_on);
    return {
      title: id === "all" ? "Property managers" : `Property managers: ${statusLabel(id).toLowerCase()}`,
      subtitle: `${n(list.length)}${list.length === 50 ? "+" : ""} companies`,
      status: settings ? (sending ? `Sending, up to ${settings.daily_cap} a day` : "Sending is off") : "Not set up",
      fields: [],
      sections: [{ title: "Most recently changed", rows: list.map((c) => row(`${s(c.name)}${c.email ? ` · ${s(c.email)}` : ""} · ${statusLabel(s(c.status))}`, "mkt.pm_company", c.id)), empty: "None." }],
      actions: settings
        ? [sending ? { id: "sending_off", label: "Stop sending", tone: "danger", confirm: "Stop all property-manager emails until switched on again?" } : { id: "sending_on", label: "Switch sending on", tone: "primary", confirm: "Start sending property-manager emails, a few each weekday?" }]
        : [],
      note: settings ? "Open a company to approve its emails, give it an address, or stop it." : "Write the story and offer on the property-manager settings first; then sending can be switched on here.",
    };
  },
  async act(ctx, _id, action) {
    if (action !== "sending_on" && action !== "sending_off") return unknown;
    const st = await pmSettings(ctx);
    if (!st) return { ok: false, error: "Property-manager email isn't set up yet." };
    return result(
      await savePmSettings({
        sendingOn: action === "sending_on",
        autoApprove: Boolean(st.auto_approve),
        dailyCap: num(st.daily_cap) || 5,
        fromName: s(st.from_name),
        story: s(st.story),
        offer: s(st.offer),
        towns: Array.isArray(st.towns) ? st.towns.join("\n") : "",
      })
    );
  },
};

async function pmSettings(ctx: EntityContext): Promise<Row | null> {
  const { data } = await ctx.sb.from("pm_outreach_settings").select("sending_on, auto_approve, daily_cap, from_name, story, offer, towns").eq("organization_id", ctx.organizationId).maybeSingle();
  return (data as Row | null) ?? null;
}

/* ------------------------------------------------------------------ */
/* Local groups                                                        */
/* ------------------------------------------------------------------ */

const group: EntityHandler = {
  kind: "mkt.group",
  async load(ctx, id) {
    const g = await one(ctx, "community_groups", "id, name, area, platform, external_url, member_count, business_post_cents, pass_days, decline_message, block_words, archived_at", id);
    if (!g) return null;
    const [posts, passes] = await Promise.all([
      many(ctx, "community_group_posts", "id, kind, summary, author_name, handled_at, posted_at", (q) => q.eq("group_id", id).order("posted_at", { ascending: false }).limit(25)),
      many(ctx, "group_post_passes", "id, business_name, status, amount_cents, expires_at", (q) => q.eq("group_id", id).order("created_at", { ascending: false }).limit(25)),
    ]);
    return {
      title: s(g.name),
      subtitle: `${statusLabel(s(g.platform))}${g.area ? ` · ${s(g.area)}` : ""}`,
      status: g.archived_at ? "Archived" : "Running",
      fields: [
        f("Members", g.member_count == null ? "Not counted" : n(num(g.member_count))),
        f("Business post", g.business_post_cents == null ? "Not for sale" : `${centsText(num(g.business_post_cents))} for ${g.pass_days} days`),
        f("Address", s(g.external_url)),
        f("Blocked words", Array.isArray(g.block_words) ? String(g.block_words.length) : "0"),
      ],
      sections: [
        { title: "Recent posts", rows: posts.map((p) => row(`${dateText(s(p.posted_at))} · ${statusLabel(s(p.kind))}${p.author_name ? ` · ${s(p.author_name)}` : ""}${p.handled_at ? " · handled" : ""} — ${clip(s(p.summary), 60)}`, "mkt.group_post", p.id)), empty: "None filed." },
        { title: "Paid passes", rows: passes.map((p) => row(`${s(p.business_name)} · ${centsText(num(p.amount_cents))} · ${statusLabel(s(p.status))}`, "mkt.group_pass", p.id)), empty: "None sold." },
      ],
      actions: [
        { id: "members", label: "Update members", input: { type: "number", label: "Members now", initial: g.member_count == null ? "" : String(g.member_count) } },
        g.archived_at ? { id: "unarchive", label: "Bring back" } : { id: "archive", label: "Archive", tone: "danger", confirm: "Archive this group? Its posts and passes are kept." },
      ],
    };
  },
  async act(ctx, id, action, value) {
    const g = await one(ctx, "community_groups", "id, name, area, platform, external_url, member_count, business_post_cents, pass_days, decline_message, block_words", id);
    if (!g) return gone;
    if (action === "archive" || action === "unarchive") return result(await archiveGroup({ id, archived: action === "archive" }), action === "archive" ? "Archived." : "Back on the list.");
    if (action === "members") {
      const r = await saveGroup({
        id,
        name: s(g.name),
        area: s(g.area),
        platform: s(g.platform),
        externalUrl: s(g.external_url),
        memberCount: value ?? "",
        businessPostDollars: g.business_post_cents == null ? "" : String(num(g.business_post_cents) / 100),
        passDays: String(g.pass_days ?? 30),
        declineMessage: s(g.decline_message),
        blockWords: Array.isArray(g.block_words) ? g.block_words.join("\n") : "",
      });
      return result(r, "Saved.");
    }
    return unknown;
  },
};

const groupPost: EntityHandler = {
  kind: "mkt.group_post",
  async load(ctx, id) {
    const p = await one(ctx, "community_group_posts", "id, group_id, kind, service, urgency, author_name, summary, posted_text, handled_at, handled_note, posted_at", id);
    if (!p) return null;
    const g = await one(ctx, "community_groups", "id, name", s(p.group_id));
    return {
      title: clip(s(p.summary) || s(p.posted_text), 80) || "A post",
      subtitle: `${statusLabel(s(p.kind))}${p.author_name ? ` from ${s(p.author_name)}` : ""}`,
      status: p.handled_at ? "Handled" : "Not handled",
      fields: [f("Posted", dateText(s(p.posted_at))), f("Service", s(p.service)), f("Urgency", statusLabel(s(p.urgency))), f("What it said", s(p.posted_text)), ...(p.handled_note ? [f("Note", s(p.handled_note))] : [])],
      sections: g ? [{ title: "Group", rows: [row(s(g.name), "mkt.group", g.id)] }] : [],
      actions: p.handled_at
        ? [{ id: "reopen", label: "Not handled after all" }]
        : [{ id: "handled", label: "Mark handled", tone: "primary", input: { type: "text", label: "What was done (optional)", placeholder: "Called them, booked Thursday" } }],
    };
  },
  async act(ctx, id, action, value) {
    if (!(await one(ctx, "community_group_posts", "id", id))) return gone;
    if (action !== "handled" && action !== "reopen") return unknown;
    return result(await markPostHandled({ id, note: value ?? "", handled: action === "handled" }), action === "handled" ? "Handled." : "Back on the list.");
  },
};

const groupPass: EntityHandler = {
  kind: "mkt.group_pass",
  async load(ctx, id) {
    const p = await one(ctx, "group_post_passes", "id, group_id, business_name, contact_name, email, phone, code, amount_cents, status, paid_at, expires_at", id);
    if (!p) return null;
    const g = await one(ctx, "community_groups", "id, name", s(p.group_id));
    return {
      title: s(p.business_name),
      subtitle: s(p.contact_name),
      status: statusLabel(s(p.status)),
      fields: [f("Code", s(p.code)), f("Amount", centsText(num(p.amount_cents))), f("Paid", dateText(s(p.paid_at))), f("Expires", dateText(s(p.expires_at))), f("Email", s(p.email)), f("Phone", s(p.phone))],
      sections: g ? [{ title: "Group", rows: [row(s(g.name), "mkt.group", g.id)] }] : [],
      actions: p.status === "paid" ? [{ id: "used", label: "Mark used", tone: "primary" }] : [],
    };
  },
  async act(ctx, id, action) {
    if (action !== "used") return unknown;
    if (!(await one(ctx, "group_post_passes", "id", id))) return gone;
    return result(await markPassUsed({ id }), "Marked used.");
  },
};

/* ------------------------------------------------------------------ */
/* Social posts                                                        */
/* ------------------------------------------------------------------ */

/** One post sent now, the way the daily run sends it: claimed, published, marked. */
async function postNow(ctx: EntityContext, post: Row): Promise<ActionResult> {
  if (!(await canPublishToFacebook(ctx.organizationId))) {
    return { ok: false, error: "No Facebook page is connected for posting. Post it by hand, then press Mark posted." };
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const imageUrl = post.image_path
    ? `${base}/storage/v1/object/public/social-posts/${s(post.image_path)}`
    : post.plan_day
      ? `${(await outboundBaseUrl()).replace(/\/$/, "")}/api/social/card/${s(post.id)}`
      : null;
  if (!imageUrl) return { ok: false, error: "This post has no picture yet." };
  const { data: claimed } = await ctx.sb
    .from("social_posts")
    .update({ channel: "posting", updated_at: new Date().toISOString() })
    .eq("id", post.id)
    .eq("organization_id", ctx.organizationId)
    .in("status", ["draft", "scheduled"])
    .or("channel.is.null,channel.neq.posting")
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "It is already being posted." };
  const sent = await publishPhotoToPage({ organizationId: ctx.organizationId, imageUrl, caption: s(post.caption) });
  if (!sent.ok) {
    await ctx.sb.from("social_posts").update({ channel: null, updated_at: new Date().toISOString() }).eq("id", post.id).eq("organization_id", ctx.organizationId);
    return { ok: false, error: sent.message ?? "Facebook didn't take it." };
  }
  return result(await markPosted(s(post.id), "facebook"), "Posted to Facebook.");
}

const socialPost: EntityHandler = {
  kind: "mkt.social_post",
  async load(ctx, id) {
    const p = await one(ctx, "social_posts", "id, job_id, zone_name, caption, hook, body, status, scheduled_for, posted_at, channel, kind, placement, plan_day, image_path, created_at", id);
    if (!p) return null;
    const moves = postMoves({ status: s(p.status), placement: s(p.placement) || null });
    const actions: EntityAction[] = [];
    if (moves.includes("post_now")) actions.push({ id: "post_now", label: "Post now", tone: "primary", confirm: "Post this to the Facebook page now?" });
    if (moves.includes("mark_posted")) actions.push({ id: "mark_posted", label: "Mark posted (put up by hand)" });
    if (moves.includes("reschedule"))
      actions.push({ id: "reschedule", label: "Move it", input: { type: "date", label: "Day to post (goes out at the morning run)", initial: s(p.scheduled_for).slice(0, 10) || new Date().toISOString().slice(0, 10), required: true } });
    if (moves.includes("skip")) actions.push({ id: "skip", label: "Skip", tone: "danger", confirm: "Skip this post? It won't go out." });
    const caption = s(p.caption) || [s(p.hook), s(p.body)].filter(Boolean).join("\n\n");
    return {
      title: clip(s(p.hook) || caption, 70) || "A post",
      subtitle: `${p.placement === "group" ? "For local groups" : "For the page"}${p.zone_name ? ` · ${s(p.zone_name)}` : ""}`,
      status: statusLabel(s(p.status)),
      fields: [
        f(p.status === "posted" ? "Posted" : "Goes out", p.status === "posted" ? whenText(s(p.posted_at)) : whenText(s(p.scheduled_for))),
        ...(p.channel && p.channel !== "posting" ? [f("Where", s(p.channel))] : []),
        f("Caption", caption),
      ],
      actions,
      note: p.status === "scheduled" ? "Scheduled posts go out on their own at the first daily run after their time, when a page is connected." : undefined,
    };
  },
  async act(ctx, id, action, value) {
    const p = await one(ctx, "social_posts", "id, status, placement, caption, image_path, plan_day", id);
    if (!p) return gone;
    if (!postMoves({ status: s(p.status), placement: s(p.placement) || null }).includes(action as never)) return { ok: false, error: "This post has already gone or been skipped." };
    if (action === "post_now") return postNow(ctx, p);
    if (action === "mark_posted") return result(await markPosted(id, p.placement === "group" ? "groups-by-hand" : "page-by-hand"), "Marked posted.");
    if (action === "reschedule") {
      const at = easternMorning(value ?? "");
      if (!at) return { ok: false, error: "Pick a day." };
      return result(await reschedulePost(id, at));
    }
    if (action === "skip") return result(await skipPlanPost(id), "Skipped.");
    return unknown;
  },
};

/** id: a social_posts status, or "late" for scheduled posts past their time. */
const postList: EntityHandler = {
  kind: "mkt.post_list",
  async load(ctx, id) {
    const status = id === "late" ? "scheduled" : id;
    const list = await many(ctx, "social_posts", "id, hook, caption, status, scheduled_for, posted_at, placement", (q) => {
      let x = q.eq("status", status);
      if (id === "late") x = x.lt("scheduled_for", new Date().toISOString());
      return x.order(status === "posted" ? "posted_at" : "scheduled_for", { ascending: status !== "posted", nullsFirst: false }).limit(40);
    });
    return {
      title: id === "late" ? "Posts past their time" : `Posts: ${statusLabel(id).toLowerCase()}`,
      subtitle: `${n(list.length)}${list.length === 40 ? "+" : ""}`,
      fields: [],
      sections: [
        {
          title: status === "posted" ? "Newest first" : "Soonest first",
          rows: list.map((p) => row(`${status === "posted" ? dateText(s(p.posted_at)) : whenText(s(p.scheduled_for))} · ${p.placement === "group" ? "group" : "page"} — ${clip(s(p.hook) || s(p.caption), 70)}`, "mkt.social_post", p.id)),
          empty: "None.",
        },
      ],
      actions: [],
      note: "Open one to post it now, move it, or skip it.",
    };
  },
};

/* ------------------------------------------------------------------ */
/* Outreach links and replies                                          */
/* ------------------------------------------------------------------ */

const outreachLink: EntityHandler = {
  kind: "mkt.outreach_link",
  async load(ctx, id) {
    const l = await one(ctx, "outreach_links", "id, profile_id, code, kind, platform, audience, sent_to, service, note, click_count, first_click_at, last_click_at, response, response_note, responded_at, comment, posted_comment, post_url, created_at", id);
    if (!l) return null;
    const who = await personName(ctx, l.profile_id);
    const link = trackedLink(await outboundBaseUrl(), s(l.code));
    return {
      title: `${statusLabel(s(l.platform))} ${s(l.kind) === "comment" ? "reply" : "link"}`,
      subtitle: `${who} · ${dateText(s(l.created_at))}`,
      status: l.response ? RESPONSES.find((r) => r.key === l.response)?.label ?? s(l.response) : `${n(num(l.click_count))} clicks`,
      fields: [
        f("Tracked link", link),
        f("Clicks", `${n(num(l.click_count))}${l.last_click_at ? `, last ${dateText(s(l.last_click_at))}` : ""}`),
        f("Where", s(l.post_url) || s(l.sent_to) || s(l.audience)),
        f("Service", s(l.service)),
        ...(l.posted_comment ? [f("What was posted", s(l.posted_comment))] : l.comment ? [f("Drafted reply", s(l.comment))] : []),
        ...(l.response_note ? [f("Note", s(l.response_note))] : []),
      ],
      sections: l.profile_id ? [{ title: "Shared by", rows: [row(who, "mkt.affiliate", l.profile_id)] }] : [],
      actions: [
        {
          id: "response",
          label: "Save what happened",
          input: { type: "select", label: "What happened", initial: s(l.response), options: [...RESPONSES.map((r) => ({ value: r.key, label: r.label })), { value: "clear", label: "Clear it" }] },
        },
        { id: "posted", label: "Save what was posted", input: { type: "textarea", label: "The reply as it went up", initial: s(l.posted_comment) || s(l.comment) } },
      ],
    };
  },
  async act(ctx, id, action, value) {
    if (!(await one(ctx, "outreach_links", "id", id))) return gone;
    if (action === "response") {
      if (!value) return { ok: false, error: "Pick what happened." };
      return result(await recordResponse({ id, response: value === "clear" ? null : (value as OutreachResponse), note: "" }), "Saved.");
    }
    if (action === "posted") {
      const r = await recordPostedComment({ id, text: value ?? "" });
      return r.ok ? { ok: true, message: [r.summary, ...r.problems].join(" ") } : { ok: false, error: r.error };
    }
    return unknown;
  },
};

/** id: a platform ("facebook"), or "replies" for the comment replies. */
const linkList: EntityHandler = {
  kind: "mkt.link_list",
  async load(ctx, id) {
    const list = await many(ctx, "outreach_links", "id, profile_id, platform, kind, click_count, created_at, comment, posted_comment", (q) =>
      (id === "replies" ? q.eq("kind", "comment") : q.eq("platform", id)).order("created_at", { ascending: false }).limit(40)
    );
    return {
      title: id === "replies" ? "Replies posted" : `${statusLabel(id)} links`,
      subtitle: `${n(list.length)}${list.length === 40 ? "+" : ""} · ${n(list.reduce((a, l) => a + num(l.click_count), 0))} clicks`,
      fields: [],
      sections: [
        {
          title: "Newest first",
          rows: list.map((l) => row(`${dateText(s(l.created_at))} · ${s(l.platform)} · ${n(num(l.click_count))} clicks${l.posted_comment || l.comment ? ` — ${clip(s(l.posted_comment) || s(l.comment), 60)}` : ""}`, "mkt.outreach_link", l.id)),
          empty: "None yet.",
        },
      ],
      actions: [],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Lead lists                                                          */
/* ------------------------------------------------------------------ */

/** id: a prospect status. */
const prospectList: EntityHandler = {
  kind: "mkt.prospect_list",
  async load(ctx, id) {
    if (!(PROSPECT_STATUSES as readonly string[]).includes(id)) return null;
    const [total, list] = await Promise.all([
      tally(ctx, "lead_prospects", (q) => q.eq("status", id)),
      many(ctx, "lead_prospects", "id, owner_name, address, city, score, estimated_ticket, do_not_contact", (q) =>
        q.eq("status", id).order("score", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false }).limit(50)
      ),
    ]);
    return {
      title: `Prospects: ${statusLabel(id).toLowerCase()}`,
      subtitle: `${n(total)} owners`,
      fields: [],
      sections: [
        {
          title: total > 50 ? "The 50 best scored" : "Best scored first",
          rows: list.map((p) => row(`${s(p.owner_name) || "Owner unknown"} · ${s(p.address)}${p.city ? `, ${s(p.city)}` : ""}${p.estimated_ticket ? ` · ~$${n(num(p.estimated_ticket))}` : ""}${p.do_not_contact ? " · do not contact" : ""}`, "mkt.prospect", p.id)),
          empty: "Nobody here.",
        },
      ],
      actions: [],
      note: "Open one to mark it contacted, rejected or converted.",
    };
  },
};

const prospect: EntityHandler = {
  kind: "mkt.prospect",
  async load(ctx, id) {
    const p = await one(ctx, "lead_prospects", "id, owner_name, address, city, state, zip, phone, email, status, do_not_contact, do_not_contact_reason, source, source_batch, acreage, sqft, year_built, assessed_value, estimated_ticket, score, notes, created_at", id);
    if (!p) return null;
    const label: Record<ProspectStatus, string> = { new: "Back to new", queued: "Queue to contact", contacted: "Mark contacted", converted: "Mark converted", rejected: "Mark rejected" };
    const actions: EntityAction[] = prospectMoves(s(p.status), Boolean(p.do_not_contact)).map((st) => ({
      id: st,
      label: label[st],
      tone: st === "contacted" ? "primary" : "default",
    }));
    if (!p.do_not_contact) actions.push({ id: "dnc", label: "Never contact", tone: "danger", confirm: "Never contact this owner again? This can't be undone here.", input: { type: "text", label: "Why (optional)" } });
    return {
      title: s(p.owner_name) || s(p.address),
      subtitle: [s(p.address), s(p.city), s(p.state), s(p.zip)].filter(Boolean).join(", "),
      status: p.do_not_contact ? "Do not contact" : statusLabel(s(p.status)),
      fields: [
        f("Phone", s(p.phone)),
        f("Email", s(p.email)),
        f("Score", p.score == null ? "" : String(p.score)),
        f("Likely ticket", p.estimated_ticket ? `$${n(num(p.estimated_ticket))}` : ""),
        f("Lot", p.acreage ? `${p.acreage} acres` : ""),
        f("House", [p.sqft ? `${n(num(p.sqft))} sq ft` : "", p.year_built ? `built ${p.year_built}` : ""].filter(Boolean).join(", ")),
        f("Assessed", p.assessed_value ? `$${n(num(p.assessed_value))}` : ""),
        f("Source", [s(p.source), s(p.source_batch)].filter(Boolean).join(" · ")),
        ...(p.do_not_contact_reason ? [f("Why not", s(p.do_not_contact_reason))] : []),
        ...(p.notes ? [f("Notes", s(p.notes))] : []),
      ],
      sections: [{ title: "The list", rows: [row(`Everyone ${statusLabel(s(p.status)).toLowerCase()}`, "mkt.prospect_list", s(p.status))] }],
      actions,
    };
  },
  async act(ctx, id, action, value) {
    if (!(await one(ctx, "lead_prospects", "id", id))) return gone;
    if (action === "dnc") return result(await setDoNotContact(id, value?.trim() || null), "Never to be contacted.");
    if ((PROSPECT_STATUSES as readonly string[]).includes(action)) return result(await setProspectStatus(id, action as ProspectStatus), `Marked ${action}.`);
    return unknown;
  },
};

/* ------------------------------------------------------------------ */
/* Google reviews                                                      */
/* ------------------------------------------------------------------ */

async function gbpConnected(ctx: EntityContext): Promise<boolean> {
  const gbp = await getIntegration(ctx.organizationId, "google_business").catch(() => null);
  return gbp?.status === "connected";
}

const review: EntityHandler = {
  kind: "mkt.review",
  async load(ctx, id) {
    const r = await one(ctx, "google_reviews", "id, author, stars, body, reviewed_at, reply_status, reply_draft, reply_body, reply_posted_at, reply_error", id);
    if (!r) return null;
    const connected = await gbpConnected(ctx);
    const moves = reviewMoves(s(r.reply_status), connected);
    const actions: EntityAction[] = [];
    if (moves.includes("post_reply"))
      actions.push({ id: "post_reply", label: "Post this reply", tone: "primary", confirm: "Post this reply on Google?", input: { type: "textarea", label: "The reply", initial: s(r.reply_draft), required: true } });
    if (moves.includes("draft")) actions.push({ id: "draft", label: "Write a reply for me" });
    if (moves.includes("skip")) actions.push({ id: "skip", label: "Leave without a reply", tone: "danger", confirm: "Leave this review without a reply?" });
    const label: Record<string, string> = { none: "Not answered", drafted: "Drafted", held: "Waiting for you", posted: "Replied", failed: "Reply failed", skipped: "Left without a reply", existing: "Answered on Google" };
    return {
      title: `${s(r.author) || "A Google user"} · ${r.stars ?? "no"} star${r.stars === 1 ? "" : "s"}`,
      subtitle: dateText(s(r.reviewed_at)),
      status: label[s(r.reply_status)] ?? s(r.reply_status),
      fields: [
        f("Review", s(r.body) || "(no words)"),
        ...(r.reply_body ? [f("Reply", s(r.reply_body)), f("Replied", dateText(s(r.reply_posted_at)))] : []),
        ...(r.reply_error ? [f("Google said", s(r.reply_error))] : []),
      ],
      actions,
      note: connected ? "Replies to 4–5 stars post themselves; 1–3 stars always wait for you." : "Google Business Profile isn't connected, so replies can't be posted from here.",
    };
  },
  async act(ctx, id, action, value) {
    const r = await one(ctx, "google_reviews", "id, reply_status", id);
    if (!r) return gone;
    if (!reviewMoves(s(r.reply_status), await gbpConnected(ctx)).includes(action as never)) return { ok: false, error: "That can't be done to this review now." };
    if (action === "post_reply") return result(await approveReviewReply(id, value ?? ""), "Reply posted.");
    if (action === "skip") return result(await skipReviewReply(id), "Left without a reply.");
    if (action === "draft") {
      const d = await draftReplyNow(id);
      return d.ok ? { ok: true, message: "Drafted. Read it, change it if you like, and post it." } : { ok: false, error: d.error };
    }
    return unknown;
  },
};

/** id: "held" for replies waiting, or "recent". */
const reviewList: EntityHandler = {
  kind: "mkt.review_list",
  async load(ctx, id) {
    const list = await many(ctx, "google_reviews", "id, author, stars, body, reviewed_at, reply_status", (q) =>
      (id === "held" ? q.in("reply_status", ["held", "failed"]) : q).order("reviewed_at", { ascending: false }).limit(40)
    );
    return {
      title: id === "held" ? "Replies waiting for you" : "Google reviews",
      subtitle: `${n(list.length)}${list.length === 40 ? "+" : ""}`,
      fields: [],
      sections: [{ title: "Newest first", rows: list.map((r) => row(`${"★".repeat(num(r.stars))} ${s(r.author) || "A Google user"} · ${statusLabel(s(r.reply_status))} — ${clip(s(r.body), 60)}`, "mkt.review", r.id)), empty: "None." }],
      actions: [],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Orders from the website                                             */
/* ------------------------------------------------------------------ */

const mowOrder: EntityHandler = {
  kind: "mkt.mow_order",
  async load(ctx, id) {
    const o = await one(ctx, "mow_orders", "id, name, email, phone, address, tier, amount_cents, status, paid_at, called_at, mow_day, note, created_at", id);
    if (!o) return null;
    return {
      title: s(o.name),
      subtitle: s(o.address),
      status: statusLabel(s(o.status)),
      fields: [f("Phone", s(o.phone)), f("Email", s(o.email)), f("Size", statusLabel(s(o.tier))), f("Amount", centsText(o.amount_cents == null ? null : num(o.amount_cents))), f("Paid", dateText(s(o.paid_at))), f("Mow day", statusLabel(s(o.mow_day))), f("Called", o.called_at ? whenText(s(o.called_at)) : "Not yet"), f("Ordered", whenText(s(o.created_at))), ...(o.note ? [f("Note", s(o.note))] : [])],
      actions: !o.called_at && o.status !== "cancelled" ? [{ id: "called", label: "Mark called", tone: "primary" }] : [],
    };
  },
  async act(ctx, id, action) {
    if (action !== "called") return unknown;
    if (!(await one(ctx, "mow_orders", "id", id))) return gone;
    return result(await markMowCalled(id), "Marked called.");
  },
};

const saltOrder: EntityHandler = {
  kind: "mkt.salt_order",
  async load(ctx, id) {
    const o = await one(ctx, "salt_orders", "id, name, email, phone, address, surface, pet_friendly, treatments, treatments_used, amount_cents, status, paid_at, note, created_at", id);
    if (!o) return null;
    return {
      title: s(o.name),
      subtitle: s(o.address),
      status: statusLabel(s(o.status)),
      fields: [f("Phone", s(o.phone)), f("Email", s(o.email)), f("Surface", statusLabel(s(o.surface))), f("Pet friendly", o.pet_friendly ? "Yes" : "No"), f("Treatments", `${num(o.treatments_used)} of ${num(o.treatments)} used`), f("Amount", centsText(num(o.amount_cents))), f("Paid", dateText(s(o.paid_at))), f("Ordered", dateText(s(o.created_at))), ...(o.note ? [f("Note", s(o.note))] : [])],
      actions: [{ id: "note", label: "Save note", input: { type: "textarea", label: "Note for the crew", initial: s(o.note) } }],
    };
  },
  async act(ctx, id, action, value) {
    if (action !== "note") return unknown;
    const { error } = await ctx.sb.from("salt_orders").update({ note: value?.trim() || null, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ctx.organizationId);
    return error ? { ok: false, error: error.message } : { ok: true, message: "Saved." };
  },
};

/* ------------------------------------------------------------------ */
/* Website pages                                                       */
/* ------------------------------------------------------------------ */

async function siteContent(ctx: EntityContext): Promise<{ content: WebsiteContent; slug: string | null; publishedAt: string | null }> {
  const [{ data: org }, { data: site }] = await Promise.all([
    ctx.sb.from("organizations").select("name, slug").eq("id", ctx.organizationId).maybeSingle(),
    ctx.sb.from("website_settings").select("content, published_at").eq("organization_id", ctx.organizationId).maybeSingle(),
  ]);
  return { content: normalizeWebsite((site as Row | null)?.content, (org as Row | null)?.name), slug: s((org as Row | null)?.slug) || null, publishedAt: s((site as Row | null)?.published_at) || null };
}

const webPage: EntityHandler = {
  kind: "mkt.web_page",
  async load(ctx, id) {
    const page = parsePageId(id);
    if (!page) return null;
    const { content, slug, publishedAt } = await siteContent(ctx);
    const base = `/site${slug ? `?org=${slug}` : ""}`;
    const published = f("Last published", publishedAt ? whenText(publishedAt) : "Never: showing the defaults");
    if (page.kind === "home") {
      return {
        title: "Home page",
        subtitle: content.businessName,
        fields: [f("Headline", content.heroHeadline), f("Under it", content.heroSub), f("Button", content.ctaLabel), f("Services listed", String(content.services.length)), f("Town pages", String(content.areas.length)), f("Address", base), published],
        sections: [{ title: "Town pages", rows: content.areas.map((a) => row(a.town, "mkt.web_page", `area:${areaSlug(a.town)}`)), empty: "None." }],
        actions: [
          { id: "headline", label: "Publish headline", input: { type: "text", label: "Headline", initial: content.heroHeadline, required: true } },
          { id: "sub", label: "Publish line under it", input: { type: "textarea", label: "Under the headline", initial: content.heroSub } },
          { id: "add_area", label: "Add a town page", input: { type: "text", label: "Town", placeholder: "Bel Air", required: true } },
        ],
        note: "Saving here publishes straight away. The full editor is in Website above.",
      };
    }
    if (page.kind === "area") {
      const area = content.areas.find((a) => areaSlug(a.town) === page.slug);
      if (!area) return null;
      return {
        title: `${area.town} page`,
        subtitle: `/site/areas/${page.slug}`,
        fields: [f("What it says", area.intro || "The standard paragraph for the town"), published],
        actions: [
          { id: "intro", label: "Publish", tone: "primary", input: { type: "textarea", label: "What the page says about working there (empty for the standard one)", initial: area.intro } },
          { id: "remove", label: "Take the page down", tone: "danger", confirm: `Take the ${area.town} page down?` },
        ],
      };
    }
    const shown = page.kind === "quick-mow" ? content.showQuickMow : content.showSalt;
    return {
      title: page.kind === "quick-mow" ? "Quick mow page" : "Salt pre-book page",
      status: shown ? "On the website" : "Hidden",
      fields: [published],
      actions: [shown ? { id: "hide", label: "Hide from the website", tone: "danger", confirm: "Hide this page's link from the website?" } : { id: "show", label: "Show on the website", tone: "primary" }],
    };
  },
  async act(ctx, id, action, value) {
    const page = parsePageId(id);
    if (!page) return gone;
    const { content } = await siteContent(ctx);
    let next: WebsiteContent | null = null;
    if (page.kind === "home") {
      if (action === "headline" && value?.trim()) next = { ...content, heroHeadline: value.trim() };
      if (action === "sub") next = { ...content, heroSub: (value ?? "").trim() };
      if (action === "add_area") {
        const town = (value ?? "").trim();
        if (!town || !areaSlug(town)) return { ok: false, error: "Name the town." };
        if (content.areas.some((a) => areaSlug(a.town) === areaSlug(town))) return { ok: false, error: "That town already has a page." };
        next = { ...content, areas: [...content.areas, { town, intro: "" }] };
      }
    } else if (page.kind === "area") {
      if (!content.areas.some((a) => areaSlug(a.town) === page.slug)) return gone;
      if (action === "intro") next = { ...content, areas: content.areas.map((a) => (areaSlug(a.town) === page.slug ? { ...a, intro: (value ?? "").trim() } : a)) };
      if (action === "remove") next = { ...content, areas: content.areas.filter((a) => areaSlug(a.town) !== page.slug) };
    } else if (action === "show" || action === "hide") {
      next = page.kind === "quick-mow" ? { ...content, showQuickMow: action === "show" } : { ...content, showSalt: action === "show" };
    }
    if (!next) return unknown;
    const r = await publishWebsite(next);
    return r.ok ? { ok: true, message: "Published." } : { ok: false, error: r.error };
  },
};

/** What can be opened and done from the Marketing page's lists. */
export const MARKETING_HANDLERS: EntityHandler[] = [
  campaign,
  campaignList,
  campaignRecipient,
  mailing,
  flyerRun,
  flyerBooking,
  play,
  playList,
  affiliate,
  referredJob,
  pmCompany,
  pmEmail,
  pmList,
  group,
  groupPost,
  groupPass,
  socialPost,
  postList,
  outreachLink,
  linkList,
  prospectList,
  prospect,
  review,
  reviewList,
  mowOrder,
  saltOrder,
  webPage,
];

/** For a test: every kind here is the department's own. */
export const MARKETING_KINDS: string[] = MARKETING_HANDLERS.map((h) => h.kind);
