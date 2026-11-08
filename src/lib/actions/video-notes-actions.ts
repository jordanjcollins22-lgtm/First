"use server";

import Anthropic from "@anthropic-ai/sdk";

import { getRealProfile } from "@/lib/data/team";
import { env, isAnthropicConfigured } from "@/lib/env";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { isOwnerLevel } from "@/lib/roles";
import { MAX_TRANSCRIPT_CHARS, notesPrompt, parseNotes, youtubeId, type VideoNotes } from "@/lib/video-notes";
import { fetchTitle, fetchTranscript } from "@/lib/youtube-transcript";

/**
 * Reads a YouTube video for the owner and sends back the notes (video-notes.ts).
 * Owner only; on a preview build the review page may use it too.
 */

export type NotesResult =
  | { ok: true; title: string; author: string; minutes: number; notes: VideoNotes; fromPaste: boolean }
  | { ok: false; error: string; needsPaste?: boolean };

export async function readVideo(input: { link: string; know: string; want: string[]; pasted?: string }): Promise<NotesResult> {
  try {
    if (!reviewPagesEnabled()) {
      const me = await getRealProfile();
      if (!me || !isOwnerLevel(me.roles)) return { ok: false, error: "Only an owner can use this." };
    }
    if (!isAnthropicConfigured) return { ok: false, error: "AI isn't set up on this site yet." };

    const pasted = (input.pasted ?? "").replace(/\s+/g, " ").trim();
    let title = "";
    let author = "";
    let seconds = 0;
    let transcript = pasted;
    const linkId = youtubeId(input.link);
    if (transcript && linkId) ({ title, author } = await fetchTitle(linkId));
    if (!transcript) {
      const id = youtubeId(input.link);
      if (!id) return { ok: false, error: "That doesn't look like a YouTube link." };
      const got = await fetchTranscript(id);
      if (!got.ok) return { ok: false, error: got.error, needsPaste: true };
      ({ title, author, seconds } = got);
      transcript = got.text;
    }
    if (transcript.length < 200) return { ok: false, error: "That transcript is too short to learn anything from.", needsPaste: !pasted };

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system:
        "You read video transcripts for a busy small-business owner so they don't have to watch. You pull out exactly what they need, " +
        "aimed at what they said they want, in plain words. You never invent anything the transcript doesn't say. You answer with JSON only.",
      messages: [
        {
          role: "user",
          content: notesPrompt({ title, know: input.know.slice(0, 1000), want: input.want.map((w) => w.slice(0, 300)).slice(0, 6), transcript: transcript.slice(0, MAX_TRANSCRIPT_CHARS) }),
        },
      ],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "Couldn't read this one." };
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const notes = parseNotes(raw);
    if (!notes) return { ok: false, error: "Couldn't make notes from this one. Try again in a moment." };
    return { ok: true, title: title || "Your video", author, minutes: Math.round(seconds / 60), notes, fromPaste: Boolean(pasted) };
  } catch (err) {
    console.error("[video-notes] failed:", err);
    return { ok: false, error: "Couldn't read this one just now. Try again in a moment." };
  }
}
