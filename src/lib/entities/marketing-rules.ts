/**
 * The pure rules behind the Marketing drawer: what can be done to a thing in
 * the state it is in, and how a few values are put into words. Kept apart
 * from the handlers so they can be tested without a database.
 */

const TZ = "America/New_York";

/** "not_interested" → "Not interested". */
export function statusLabel(status: string | null | undefined): string {
  const s = (status ?? "").replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "—";
}

/** "$17.43" from cents; a dash for nothing. */
export function centsText(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

/** "Oct 13, 2026" in the business's time zone; a dash for nothing. */
export function dateText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
}

/** "Tue, Oct 13, 9:00 AM" in the business's time zone. */
export function whenText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Cut to a length with an ellipsis, on one line. */
export function clip(text: string | null | undefined, max = 90): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/**
 * 10am Eastern on a picked day, as an ISO instant: the drawer collects a date
 * and a post goes out at the morning run. Null for anything not a date.
 */
export function easternMorning(day: string, hour = 10): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const noonUtc = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(noonUtc.getTime())) return null;
  // The offset that day: the Eastern wall clock at noon UTC, against noon.
  const wall = new Date(noonUtc.toLocaleString("en-US", { timeZone: TZ }));
  const local = new Date(noonUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetHours = Math.round((local.getTime() - wall.getTime()) / 3_600_000);
  return new Date(Date.UTC(noonUtc.getUTCFullYear(), noonUtc.getUTCMonth(), noonUtc.getUTCDate(), hour + offsetHours)).toISOString();
}

/* ------------------------------------------------------------------ */
/* What can be done, by state                                          */
/* ------------------------------------------------------------------ */

export type CampaignStatus = "draft" | "running" | "paused" | "done";
export type CampaignMove = "start" | "pause" | "resume" | "stop";

/** Draft starts; running pauses or stops; paused resumes or stops; done is done. */
export function campaignMoves(status: string): CampaignMove[] {
  switch (status) {
    case "draft":
      return ["start"];
    case "running":
      return ["pause", "stop"];
    case "paused":
      return ["resume", "stop"];
    default:
      return [];
  }
}

export const RECIPIENT_STATUSES = ["queued", "sent", "skipped", "bounced", "complained", "unsubscribed"] as const;

export type PlayMove = "approve" | "assign" | "done" | "skip";

/** Open plays can be closed or given to someone; only pending ones need approving. */
export function playMoves(play: { status: string; approval: string | null }): PlayMove[] {
  if (play.status !== "open") return [];
  const pending = !play.approval || play.approval === "pending";
  return [...(pending ? (["approve"] as PlayMove[]) : []), "assign", "done", "skip"];
}

export type PostMove = "post_now" | "mark_posted" | "reschedule" | "skip";

/**
 * Drafts and scheduled posts can go now, be moved, or be skipped. A group
 * post can only be put up by hand, so it is marked posted rather than sent.
 */
export function postMoves(post: { status: string; placement: string | null }): PostMove[] {
  if (post.status !== "draft" && post.status !== "scheduled") return [];
  const group = post.placement === "group";
  return [...(group ? [] : (["post_now"] as PostMove[])), "mark_posted", "reschedule", "skip"];
}

export type PmMove = "approve" | "rewrite" | "set_email" | "interested" | "not_interested" | "do_not_contact";

const PM_STOPPED = new Set(["interested", "not_interested", "do_not_contact", "unsubscribed"]);

/** What the existing property-manager actions accept from each status. */
export function pmMoves(company: { status: string; email: string | null; hasDrafts: boolean }): PmMove[] {
  const out: PmMove[] = [];
  if (company.status === "drafted" && company.email && company.hasDrafts) out.push("approve");
  if ((company.status === "drafted" || company.status === "approved") && company.email) out.push("rewrite");
  if (["new", "no_email", "ready", "bounced"].includes(company.status)) out.push("set_email");
  if (!PM_STOPPED.has(company.status)) out.push("interested", "not_interested");
  if (company.status !== "do_not_contact" && company.status !== "unsubscribed") out.push("do_not_contact");
  return out;
}

export const PROSPECT_STATUSES = ["new", "queued", "contacted", "converted", "rejected"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/** Every status but the one it has, in the order work moves. */
export function prospectMoves(status: string, doNotContact: boolean): ProspectStatus[] {
  if (doNotContact) return [];
  return PROSPECT_STATUSES.filter((s) => s !== status);
}

export type ReviewMove = "post_reply" | "skip" | "draft";

/** Held and failed replies wait for a person; an unanswered review can be drafted. */
export function reviewMoves(replyStatus: string, connected: boolean): ReviewMove[] {
  if (replyStatus === "held" || replyStatus === "failed") return connected ? ["post_reply", "skip"] : ["skip"];
  if (replyStatus === "none") return connected ? ["draft", "skip"] : ["skip"];
  if (replyStatus === "drafted") return connected ? ["post_reply", "skip"] : ["skip"];
  return [];
}

export type MailingStatus = "planned" | "printed" | "mailed";

/** A mailing can be moved to any other step; mailed asks for the day. */
export function mailingMoves(status: string): MailingStatus[] {
  return (["planned", "printed", "mailed"] as MailingStatus[]).filter((s) => s !== status);
}

export type FlyerRunStatus = "open" | "closed" | "printed";

export function flyerRunMoves(status: string): FlyerRunStatus[] {
  return (["open", "closed", "printed"] as FlyerRunStatus[]).filter((s) => s !== status);
}

/** A percentage typed in, as a commission rate: 0 to 100, or null to clear. */
export function parseRate(value: string | undefined): number | null | "bad" {
  const t = (value ?? "").replace(/%/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return "bad";
  return Math.round(n * 100) / 100;
}

/** A website page id: "home", "quick-mow", "salt", or "area:<slug>". */
export function parsePageId(id: string): { kind: "home" | "quick-mow" | "salt" } | { kind: "area"; slug: string } | null {
  if (id === "home" || id === "quick-mow" || id === "salt") return { kind: id };
  if (id.startsWith("area:") && id.length > 5) return { kind: "area", slug: id.slice(5) };
  return null;
}
