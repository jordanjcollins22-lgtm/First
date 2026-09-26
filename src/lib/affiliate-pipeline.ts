/**
 * Where every link a person handed out got to.
 *
 * A comment under a neighbour's post, or a message to one person, moves
 * along the same track as a client does: it is posted, somebody opens it,
 * somebody answers, somebody books, and the booking turns into a job. The
 * stage of a link is the furthest point it reached, so a person's
 * breakdown reads as a funnel of their own work: what is still sitting
 * there unopened, what got a conversation, what turned into money.
 */

import { kindLabel, platformLabel, type OutreachKind, type OutreachResponse, type OutreachRow, type Platform } from "@/lib/outreach-links";

export type AffiliateStage = "posted" | "opened" | "answered" | "booked" | "closed" | "declined";

export const AFFILIATE_STAGE_ORDER: readonly AffiliateStage[] = ["posted", "opened", "answered", "booked", "closed", "declined"];

export const AFFILIATE_STAGE_LABEL: Record<AffiliateStage, string> = {
  posted: "Posted, not opened yet",
  opened: "Opened",
  answered: "Answered",
  booked: "Booked",
  closed: "Closed",
  declined: "Said no (link still open)",
};

/** What a person needs to know about somebody who booked from their link. Contact details stay off the leaderboard. */
export interface AffiliateBookingLine {
  jobId: string;
  name: string;
  converted: boolean;
  collected: number;
  commissionEarned: number;
  commissionPaidOut: number;
}

export interface AffiliateLine {
  id: string;
  code: string;
  kind: OutreachKind;
  kindLabel: string;
  platform: Platform;
  /** "Bel Air Moms on Facebook", "to Kara T. on Instagram". Where it went, in words. */
  where: string;
  postedAt: string;
  opens: number;
  response: OutreachResponse | null;
  stage: AffiliateStage;
  bookings: AffiliateBookingLine[];
}

type LinkRow = OutreachRow & { sentTo: string | null; fromPage: string | null; audience: string | null };

export function whereLabel(row: Pick<LinkRow, "platform" | "audience" | "sentTo" | "fromPage">): string {
  const platform = platformLabel(row.platform);
  if (row.sentTo) return `to ${row.sentTo} on ${platform}`;
  if (row.audience) return `${row.audience} on ${platform}`;
  if (row.fromPage) return `${platform}, from ${row.fromPage}`;
  return platform;
}

export function linkStage(row: Pick<OutreachRow, "clickCount" | "response">, bookings: readonly Pick<AffiliateBookingLine, "converted">[]): AffiliateStage {
  if (bookings.some((b) => b.converted)) return "closed";
  if (bookings.length > 0) return "booked";
  if (row.response === "not interested" || row.response === "hostile") return "declined";
  if (row.response === "replied") return "answered";
  if (row.clickCount > 0) return "opened";
  return "posted";
}

export function affiliatePipeline(rows: readonly LinkRow[], bookingsByCode: Record<string, readonly AffiliateBookingLine[]>): AffiliateLine[] {
  return [...rows]
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .map((row) => {
      const bookings = [...(bookingsByCode[row.code] ?? [])];
      return {
        id: row.id,
        code: row.code,
        kind: row.kind,
        kindLabel: kindLabel(row.kind),
        platform: row.platform,
        where: whereLabel(row),
        postedAt: row.postedAt,
        opens: Math.max(0, row.clickCount),
        response: row.response,
        stage: linkStage(row, bookings),
        bookings,
      };
    });
}
