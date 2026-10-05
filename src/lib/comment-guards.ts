import { firstNameOf } from "@/lib/outreach-agent";

/**
 * The checks a comment passes before anybody on the team is handed it.
 *
 * Each one is a mistake that went out on Facebook. In one afternoon, 24
 * comments went up from one account in 31 minutes. Eight of them tagged
 * Jace, who had only forwarded the posts, instead of the neighbour who
 * asked. Three answered people in Baltimore City. Two promised a day
 * nobody had checked ("before Saturday is no problem"). These rules are
 * what stops that happening again.
 *
 * Pure, so the rules are tested without a database.
 */

/**
 * Who the comment may tag, or null when it should tag nobody.
 *
 * The name kept for a post is whatever the reader found nearest the top,
 * and that is not always the person asking. On a post forwarded over
 * Messenger it is the teammate who forwarded it ("Message sent Wednesday
 * by Jace"). On a post read off a search page it can be whoever invited
 * us to the group ("Jace Burgess invited you to join this group"). Tagging
 * either one is worse than tagging nobody, so a name that belongs to
 * somebody on the team, or that the post shows as the forwarder or the
 * inviter, is dropped.
 */
export function posterToTag(author: string | null | undefined, postText: string | null | undefined, teamNames: readonly string[]): string | null {
  const first = firstNameOf(author);
  if (!first) return null;
  const lower = first.toLowerCase();
  const team = new Set(teamNames.map((n) => firstNameOf(n)?.toLowerCase()).filter((n): n is string => Boolean(n)));
  if (team.has(lower)) return null;
  const text = postText ?? "";
  const escaped = escapeRegExp(first);
  if (new RegExp(`message sent[^\\n]*\\bby\\s+${escaped}\\b`, "i").test(text)) return null;
  if (new RegExp(`\\b${escaped}\\b[^\\n]{0,40}invited you to join`, "i").test(text)) return null;
  return author?.trim() || null;
}

/** Whether the post reached us forwarded over Messenger rather than seen on Facebook. */
export function isForwarded(postText: string | null | undefined): boolean {
  return /message sent\b[^\n]*\bby\s+\S+/i.test(postText ?? "");
}

/**
 * The comment without an @mention of somebody on the team at the front.
 * A comment already written with the wrong tag is fixed here rather than
 * thrown away.
 */
export function withoutTeamMention(comment: string, teamNames: readonly string[]): string {
  const match = comment.trimStart().match(/^@([\p{L}\p{N}'’-]{2,40})\s*/u);
  if (!match) return comment;
  const team = new Set(teamNames.map((n) => firstNameOf(n)?.toLowerCase()).filter((n): n is string => Boolean(n)));
  if (!team.has(match[1].toLowerCase())) return comment;
  const rest = comment.trimStart().slice(match[0].length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export interface ServiceMarket {
  cities: readonly string[];
  counties: readonly string[];
  zips: readonly string[];
}

/**
 * Places close enough to turn up in the groups we read, and outside where
 * we work. Named outright because a post from "West Baltimore" says nothing
 * about Harford, and so would never fail a check that only looks for our
 * own towns.
 */
const NEARBY_OUTSIDE = [
  "baltimore city",
  "west baltimore",
  "east baltimore",
  "north baltimore",
  "south baltimore",
  "towson",
  "parkville",
  "perry hall",
  "nottingham",
  "white marsh",
  "middle river",
  "essex",
  "dundalk",
  "rosedale",
  "catonsville",
  "glen burnie",
  "annapolis",
  "columbia",
  "ellicott city",
  "elkton",
  "rising sun",
  "cecil county",
  "pennsylvania",
  "delaware",
];

function mentions(text: string, place: string): boolean {
  return new RegExp(`\\b${escapeRegExp(place)}\\b`, "i").test(text);
}

/**
 * Why a post is outside the area we work in, or null when it is in it or
 * there is no telling.
 *
 * The town the sorter read off the post decides first. Without one, the
 * post's own words do: a place we know is outside, or "Baltimore" with
 * none of our towns beside it. A post that names nowhere is let through,
 * because most people asking in a Harford group are in Harford.
 */
export function outsideServiceArea(input: { town?: string | null; text?: string | null; markets: readonly ServiceMarket[] }): string | null {
  if (input.markets.length === 0) return null;
  const ours = input.markets.flatMap((m) => [...m.cities, ...m.counties, ...m.zips]).filter(Boolean);
  const inOurs = (value: string) => ours.some((place) => mentions(value, place));
  const town = (input.town ?? "").trim();
  if (town) {
    if (inOurs(town)) return null;
    if (NEARBY_OUTSIDE.some((p) => mentions(town, p)) || /\bbaltimore\b/i.test(town)) {
      return `This post is in ${town}, outside the area we work in.`;
    }
  }
  const text = input.text ?? "";
  if (inOurs(text)) return null;
  const outside = NEARBY_OUTSIDE.find((p) => mentions(text, p)) ?? (/\bbaltimore\b/i.test(text) ? "Baltimore" : null);
  return outside ? `This post is in ${titleCase(outside)}, outside the area we work in.` : null;
}

export interface RecentAnswer {
  createdAt: string;
  groupName: string | null;
}

/** Fewest minutes between one person's comments. */
export const MINUTES_BETWEEN_COMMENTS = 5;

/** Most comments one person makes in one group in a day. */
export const PER_GROUP_PER_DAY = 2;

/** Group names that are really the reader not finding one. */
function isRealGroup(name: string | null | undefined): name is string {
  const value = (name ?? "").trim().toLowerCase();
  return Boolean(value) && value !== "see post" && value !== "facebook";
}

/**
 * Why this person should wait before taking another post, or null.
 *
 * One account dropping a comment a minute, five of them in one group, is
 * what Facebook flags as spam, and then the account answers nobody. So
 * comments are spaced out, and a group hears from each of us at most
 * twice a day.
 */
export function pacingRefusal(input: { recent: readonly RecentAnswer[]; groupName: string | null; now: Date }): string | null {
  const now = input.now.getTime();
  const latest = input.recent.reduce((max, a) => Math.max(max, new Date(a.createdAt).getTime()), 0);
  const since = (now - latest) / 60_000;
  if (latest > 0 && since < MINUTES_BETWEEN_COMMENTS) {
    const wait = Math.max(1, Math.ceil(MINUTES_BETWEEN_COMMENTS - since));
    return `Give it ${wait} more minute${wait === 1 ? "" : "s"} before the next one. Comments posted back to back get an account flagged as spam.`;
  }
  if (isRealGroup(input.groupName)) {
    const group = input.groupName.trim().toLowerCase();
    const today = input.recent.filter(
      (a) => (a.groupName ?? "").trim().toLowerCase() === group && now - new Date(a.createdAt).getTime() < 86_400_000
    ).length;
    if (today >= PER_GROUP_PER_DAY) {
      return `You've already commented in ${input.groupName.trim()} ${today} times today. Leave this one until tomorrow so the group doesn't see us everywhere.`;
    }
  }
  return null;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
