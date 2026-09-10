/**
 * Reading a post out of a screenshot, so nobody has to type it in.
 *
 * Everything about this feature happens on a phone, in a garden, in the
 * ninety seconds between seeing a post and losing interest in it. Asking for
 * the group name, who asked, and what they want is three fields somebody gets
 * wrong or skips, and a group name spelled two ways is two groups in the
 * tally.
 *
 * The screenshot already carries all of it. The group is written across the
 * top, the poster's name is next to their picture, "3d" says how old it is,
 * and the words say what they want. So it is read once and the boxes come
 * back filled in, with a person left to correct rather than compose.
 *
 * One reader, two callers: sorting a post in a group we run, and answering
 * one in a group we do not. Two prompts would drift, and the second one to
 * drift would be the one nobody was watching.
 *
 * What is here is the brief and the reading of the answer. The model call
 * lives next to the key, in `src/lib/data/read-post.ts`.
 */

import type { PostKind, Urgency } from "@/lib/community-groups";
import { PLATFORMS, type Platform } from "@/lib/recommendations";

export interface PostReading {
  kind: PostKind;
  /** One of the business's own service names, or nothing. */
  service: string | null;
  urgency: Urgency | null;
  /** A first name at most. A group thread is full of other people. */
  author: string | null;
  summary: string;
  /** The phrases that made it look like advertising. */
  matchedWords: string[];
  /** Which app the screenshot was taken in, from the chrome around the post. */
  platform: Platform | null;
  /** The group, neighbourhood or subreddit written above the post. */
  groupName: string | null;
  /**
   * How many days ago it was posted.
   *
   * The one field that changes the wording rather than the record: a post
   * from Tuesday gets "if you haven't gotten this taken care of yet", and a
   * post from an hour ago does not.
   */
  ageDays: number | null;
}

export interface ReadingBrief {
  /** The group when we already know it, so the model is not guessing. */
  groupName: string;
  /** The service names this business actually sells. */
  services: readonly string[];
  /** What this group treats as advertising, beyond the obvious. */
  blockWords: readonly string[];
}

export function readingSystemPrompt(brief: ReadingBrief): string {
  const services = brief.services.length > 0 ? brief.services.join(", ") : "none listed";
  const extra = brief.blockWords.length > 0 ? brief.blockWords.join(", ") : "none";
  const where = brief.groupName.trim();

  return [
    where
      ? `You read posts from a local neighbourhood group called "${where}".`
      : "You read posts from local neighbourhood groups on Facebook, Nextdoor, Instagram and Reddit.",
    "",
    "You are given a screenshot of one post, and sometimes its text as well. Pull the details out of it.",
    "",
    "Answer with a single JSON object and nothing else. No prose, no code fence.",
    "",
    "{",
    '  "kind": "request" | "promotion" | "other",',
    '  "service": string | null,',
    '  "urgency": "emergency" | "soon" | "whenever" | null,',
    '  "author": string | null,',
    '  "summary": string,',
    '  "matched": string[],',
    '  "platform": "facebook" | "nextdoor" | "instagram" | "reddit" | "other" | null,',
    '  "group": string | null,',
    '  "age_days": number | null',
    "}",
    "",
    "kind:",
    '- "request" when somebody wants work done, or is asking who to hire. Include posts that only imply it, like complaining about their own overgrown yard and asking what people do about it.',
    '- "promotion" when a business or a person is advertising their own services, prices, availability or page.',
    '- "other" for anything else, including thank-you posts, somebody saying they already found a person, and general chat.',
    "",
    `service: the closest match from this list, copied exactly: ${services}. Use null when none of them fits, and never invent a name.`,
    "",
    "urgency: how soon they say they need it. Use null when they do not say.",
    "",
    "author: the poster's first name as shown. Null if it is not visible. Never a full name, and never anybody who only commented.",
    "",
    "summary: one short sentence, under 140 characters, saying what they want. Written for the person who has to answer it.",
    "",
    `matched: the exact phrases in the post that made it look like advertising, when kind is "promotion". Empty array otherwise. This group also treats these as advertising: ${extra}.`,
    "",
    "platform: which app the screenshot was taken in, judged from the layout, icons and buttons around the post. Null if you cannot tell.",
    "",
    'group: the group, neighbourhood or subreddit name written above the post, copied exactly as it appears. Null if it is not in the picture. Do not use the poster\'s name, and do not guess from the content.',
    "",
    'age_days: how many days ago it was posted, from the timestamp on the post. "3h" or "45m" is 0. "2d" is 2. "March 4" is the days between then and now if you can tell, otherwise null. Null when there is no timestamp.',
    "",
    "Be careful in one direction only. Calling a neighbour's post advertising loses a customer and a member; letting an advert through costs nothing but a moment. When you are unsure between the two, say request.",
  ].join("\n");
}

export function readingBrief(input: { pastedText: string; note: string }): string {
  const lines = ["Read this post."];
  if (input.pastedText.trim()) {
    lines.push("", "The text of it:", input.pastedText.trim());
  } else {
    lines.push("The post is in the image.");
  }
  if (input.note.trim()) lines.push("", `What we already know: ${input.note.trim()}`);
  return lines.join("\n");
}

const KINDS: PostKind[] = ["request", "promotion", "other"];
const URGENCIES: Urgency[] = ["emergency", "soon", "whenever"];

/**
 * The model's answer, or null when it did not give one.
 *
 * Null rather than a guess. Every caller already has something honest to fall
 * back to — a keyword reading, or empty boxes — and both of those beat
 * presenting half a parse as though a model stood behind it.
 */
export function readPost(raw: string, services: readonly string[]): PostReading | null {
  const parsed = parseObject(raw);
  if (!parsed) return null;

  const kind = KINDS.find((k) => k === parsed.kind);
  if (!kind) return null;

  // Compared case-folded, then stored as the business spells it, so a model
  // that lowercased "Leaf / Seasonal Cleanup" does not create a second
  // category that looks like the first one.
  const asked = typeof parsed.service === "string" ? parsed.service.trim().toLowerCase() : "";
  const service = services.find((name) => name.trim().toLowerCase() === asked) ?? null;

  const matchedWords = Array.isArray(parsed.matched)
    ? parsed.matched
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

  return {
    kind,
    service: kind === "request" ? service : null,
    urgency: kind === "request" ? (URGENCIES.find((u) => u === parsed.urgency) ?? null) : null,
    author: firstName(parsed.author),
    summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 200) : "",
    matchedWords: kind === "promotion" ? matchedWords : [],
    platform: PLATFORMS.some((p) => p.key === parsed.platform) ? (parsed.platform as Platform) : null,
    groupName: cleanGroup(parsed.group),
    ageDays: cleanAge(parsed.age_days),
  };
}

/** A first name at most, because a group thread is full of other people. */
function firstName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const first = value.trim().split(/\s+/)[0] ?? "";
  return first.length > 0 && first.length <= 40 ? first : null;
}

/**
 * The group name, or nothing.
 *
 * Length-capped rather than trusted: a model that read the whole header off a
 * screenshot would otherwise put a paragraph in the field the tallies group
 * by, and one bad name is a group of one forever.
 */
function cleanGroup(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 120 ? name : null;
}

/** Days, as a whole number, or nothing. Nonsense is dropped rather than clamped. */
function cleanAge(value: unknown): number | null {
  const days = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(days) || days < 0 || days > 3650) return null;
  return Math.round(days);
}

/**
 * The JSON object in the reply, however it arrived.
 *
 * Fenced, prefaced, or on its own. Models asked for JSON produce all three and
 * the difference is not worth a failed reading.
 */
function parseObject(raw: string): Record<string, unknown> | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.unshift(fenced[1]);
  const braced = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (braced.startsWith("{")) candidates.push(braced);

  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate.trim());
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Next shape.
    }
  }
  return null;
}
