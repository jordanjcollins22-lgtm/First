/**
 * Video notes: a YouTube video read for you, so you get what you need from
 * it without sitting through it.
 *
 * Built like the K-W-L chart from school. Before reading, you say what you
 * already Know and what you Want to know (or pick a goal). The transcript is
 * read with that in mind, and you get back what you Learned: the key
 * fundamentals first, your own questions answered, and how to Use it.
 *
 * Pure, so the link reading, the transcript parsing and the answer checking
 * are tested without YouTube or a model.
 */

/** How many key fundamentals a summary shows: enough to cover the video, few enough to read in a minute. */
export const MAX_FUNDAMENTALS = 7;

/** The goals offered as one tap, besides typing your own. */
export const GOALS = [
  "The main steps to actually do it",
  "The key ideas I need to understand",
  "Mistakes to avoid",
  "Whether it's worth watching in full",
] as const;

/** The 11-character video id from any YouTube link (watch, youtu.be, shorts, embed, live), or null. */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** "asr" for captions YouTube made itself. */
  kind?: string;
}

/** The best caption track: English written by a person, then English auto-captions, then anything. */
export function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const en = (t: CaptionTrack) => t.languageCode.toLowerCase().startsWith("en");
  return tracks.find((t) => en(t) && t.kind !== "asr") ?? tracks.find(en) ?? tracks[0] ?? null;
}

/** The words of a json3 caption file, as one block of text. */
export function textFromJson3(json: unknown): string {
  const events = (json as { events?: { segs?: { utf8?: string }[] }[] } | null)?.events ?? [];
  return events
    .flatMap((e) => (e.segs ?? []).map((s) => s.utf8 ?? ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words of a timedtext XML caption file, as one block of text. */
export function textFromXml(xml: string): string {
  const decode = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return [...xml.matchAll(/<(?:text|p)\b[^>]*>([\s\S]*?)<\/(?:text|p)>/g)]
    .map((m) => decode(decode(m[1]))) // YouTube escapes some captions twice
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface VideoNotes {
  /** One line: what the video is about. */
  gist: string;
  /** The key fundamentals, most important first. */
  fundamentals: { point: string; detail: string }[];
  /** Each thing you wanted to know, answered from the video, or said plainly that it isn't covered. */
  answers: { question: string; answer: string }[];
  /** What you learned: the short version, in a few sentences. */
  learned: string;
  /** How to put it to use: first steps. */
  use: string[];
  /** Whether it's worth watching in full, and which part if only one. */
  watchIt: string;
}

/** The instructions for reading a transcript. */
export function notesPrompt(input: { title: string; know: string; want: string[]; transcript: string }): string {
  const want = input.want.filter(Boolean);
  return [
    `Video: ${input.title || "(untitled)"}`,
    `What I already know: ${input.know.trim() || "Nothing in particular."}`,
    `What I want to get out of it: ${want.length ? want.join("; ") : "The key ideas I need to understand."}`,
    "",
    "Read the whole transcript below. Then answer as JSON only, in this shape:",
    `{"gist": "one line on what the video is about",`,
    ` "fundamentals": [{"point": "short headline", "detail": "one or two sentences, concrete, with any numbers or steps the video gives"}],`,
    ` "answers": [{"question": "each thing I want to get out of it", "answer": "what the video says about it, or say plainly that it doesn't cover it"}],`,
    ` "learned": "three or four sentences: what I now know that I didn't, given what I already knew",`,
    ` "use": ["first concrete things to do with this"],`,
    ` "watchIt": "whether it's worth watching in full, and which minutes if only part"}`,
    "",
    `Give at most ${MAX_FUNDAMENTALS} fundamentals, most important first, aimed at what I want to get out of it. Skip what I already know unless the video corrects it. ` +
      "Only use what is in the transcript; never invent facts, numbers or steps. Plain words, no filler, no sponsor reads.",
    "",
    "Transcript:",
    input.transcript,
  ].join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The model's answer, checked and trimmed, or null when it isn't usable. */
export function parseNotes(raw: string): VideoNotes | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const fundamentals = (Array.isArray(data.fundamentals) ? data.fundamentals : [])
    .map((f: { point?: unknown; detail?: unknown }) => ({ point: str(f?.point, 160), detail: str(f?.detail, 600) }))
    .filter((f) => f.point)
    .slice(0, MAX_FUNDAMENTALS);
  if (!fundamentals.length) return null;
  return {
    gist: str(data.gist, 300),
    fundamentals,
    answers: (Array.isArray(data.answers) ? data.answers : [])
      .map((a: { question?: unknown; answer?: unknown }) => ({ question: str(a?.question, 300), answer: str(a?.answer, 1200) }))
      .filter((a) => a.question && a.answer)
      .slice(0, 8),
    learned: str(data.learned, 1500),
    use: (Array.isArray(data.use) ? data.use : []).map((u) => str(u, 300)).filter(Boolean).slice(0, 6),
    watchIt: str(data.watchIt, 400),
  };
}

/** The longest transcript sent to be read, in characters (about a three-hour video). */
export const MAX_TRANSCRIPT_CHARS = 200_000;
