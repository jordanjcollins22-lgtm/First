/**
 * Reading a post and deciding what it is.
 *
 * `triageLocally` in community-groups.ts does this on keywords, instantly and
 * for nothing, and it is right most of the time. It is wrong in the way
 * keywords are always wrong: "anyone else's yard look like a jungle after that
 * storm 😩" is somebody asking for help and contains none of the phrases, and
 * "I finally found someone, thanks all!" contains several.
 *
 * So the model gets a look as well. What is here is the brief and the reading
 * of the answer — the call itself lives in the action, next to the key.
 *
 * The model is asked for JSON rather than prose because the answer goes into
 * three columns, and a sentence would have to be parsed anyway. Anything it
 * returns that is not one of the allowed values is dropped rather than
 * corrected: an invented service name would put a lead in a category no
 * proposal can be built from.
 */

import type { PostKind, Triage, Urgency } from "@/lib/community-groups";

export interface TriageBrief {
  /** The group, for tone. A post in a mums' group reads differently. */
  groupName: string;
  /** The service names this business actually sells. */
  services: readonly string[];
  /** What this group treats as advertising, on top of the obvious. */
  blockWords: readonly string[];
}

export function triageSystemPrompt(brief: TriageBrief): string {
  const services = brief.services.length > 0 ? brief.services.join(", ") : "none listed";
  const extra = brief.blockWords.length > 0 ? brief.blockWords.join(", ") : "none";

  return [
    `You sort posts from a local neighbourhood group called "${brief.groupName}".`,
    "",
    "Answer with a single JSON object and nothing else. No prose, no code fence.",
    "",
    "{",
    '  "kind": "request" | "promotion" | "other",',
    '  "service": string | null,',
    '  "urgency": "emergency" | "soon" | "whenever" | null,',
    '  "author": string | null,',
    '  "summary": string,',
    '  "matched": string[]',
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
    "author: the poster's first name if it is visible. Null otherwise. Never a full name.",
    "",
    "summary: one short sentence, under 140 characters, saying what they want. Written for the person who has to answer it.",
    "",
    `matched: the exact phrases in the post that made it look like advertising, when kind is "promotion". Empty array otherwise. This group also treats these as advertising: ${extra}.`,
    "",
    "Be careful in one direction only. Calling a neighbour's post advertising loses a customer and a member; letting an advert through costs nothing but a moment. When you are unsure between the two, say request.",
  ].join("\n");
}

export function triageBrief(input: { pastedText: string; note: string }): string {
  const lines = ["Sort this post."];
  if (input.pastedText.trim()) {
    lines.push("", "The post:", input.pastedText.trim());
  } else {
    lines.push("The post is in the image.");
  }
  if (input.note.trim()) lines.push("", `What we already know: ${input.note.trim()}`);
  return lines.join("\n");
}

export interface ReadTriage extends Triage {
  author: string | null;
  summary: string;
}

const KINDS: PostKind[] = ["request", "promotion", "other"];
const URGENCIES: Urgency[] = ["emergency", "soon", "whenever"];

/**
 * The model's answer, or null when it did not give one.
 *
 * Null rather than a guess. The caller already has a keyword reading that is
 * honest about being a keyword reading, and falling back to it beats
 * presenting a half-parsed answer as though a model stood behind it.
 */
export function readTriage(raw: string, services: readonly string[]): ReadTriage | null {
  const parsed = parseObject(raw);
  if (!parsed) return null;

  const kind = KINDS.find((k) => k === parsed.kind);
  if (!kind) return null;

  // Compared case-folded, then stored as the business spells it, so a model
  // that lowercased "Leaf / Seasonal Cleanup" does not create a second
  // category that looks like the first one.
  const asked = typeof parsed.service === "string" ? parsed.service.trim().toLowerCase() : "";
  const service = services.find((name) => name.trim().toLowerCase() === asked) ?? null;

  const urgency = URGENCIES.find((u) => u === parsed.urgency) ?? null;

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
    urgency: kind === "request" ? urgency : null,
    author: cleanName(parsed.author),
    summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 200) : "",
    matchedWords: kind === "promotion" ? matchedWords : [],
  };
}

/** A first name at most, because a group thread is full of other people. */
function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const first = value.trim().split(/\s+/)[0] ?? "";
  return first.length > 0 && first.length <= 40 ? first : null;
}

/**
 * The JSON object in the reply, however it arrived.
 *
 * Fenced, prefaced, or on its own. Models asked for JSON produce all three and
 * the difference is not worth a failed triage.
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
