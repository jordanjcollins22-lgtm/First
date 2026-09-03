"use server";

import Anthropic from "@anthropic-ai/sdk";

import { env, isAnthropicConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import {
  briefFor,
  cleanScopeText,
  systemPrompt,
  worthSuggesting,
  type ZoneBrief,
} from "@/lib/scope-suggestion";

export type ScopeSuggestion = { ok: true; text: string } | { ok: false; message: string };

/**
 * A draft scope line for one work area, written from what the evaluator
 * recorded.
 *
 * It suggests and stops, like the reply drafter next door: the text lands in
 * the box the account manager was already editing, and nothing is saved until
 * they press Save changes. That matters here because this wording is what a
 * client is quoted against.
 *
 * No fallback. A rule-written scope line would be the service name back again,
 * which is what is already in the box, so saying nothing came back is more
 * honest than pretending something did.
 */
export async function suggestZoneScope(zone: ZoneBrief): Promise<ScopeSuggestion> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    if (!isAnthropicConfigured) {
      return { ok: false, message: "AI suggestions aren't set up on this site yet." };
    }
    if (!worthSuggesting(zone)) {
      return { ok: false, message: "Add a note on this zone first, then I have something to go on." };
    }

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1000,
      thinking: { type: "adaptive" },
      // A short line from a short brief. The judgement is in what to leave
      // out, not in the writing.
      output_config: { effort: "low" },
      system: systemPrompt(),
      messages: [{ role: "user", content: briefFor(zone) }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, message: "Couldn't write one for this zone." };
    }

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    // The house style and the no-quantities rule are applied here rather than
    // trusted to the instructions. See scope-suggestion.ts.
    const text = cleanScopeText(raw);
    if (!text) return { ok: false, message: "Couldn't write one for this zone." };

    return { ok: true, text };
  } catch {
    return { ok: false, message: "Couldn't write one just now. Try again in a moment." };
  }
}
