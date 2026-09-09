"use server";

import Anthropic from "@anthropic-ai/sdk";

import { env, isAnthropicConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import {
  briefFor,
  cleanScopeText,
  cleanTidyText,
  systemPrompt,
  tidyBrief,
  tidySystemPrompt,
  worthSuggesting,
  type ZoneBrief,
} from "@/lib/scope-suggestion";
import { sameContent, tidyScope } from "@/lib/scope-format";

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

/**
 * The same scope, laid out.
 *
 * Not a rewrite. The wording on a proposal is the business's, and a client can
 * be held to it, so this reorganises and nothing else: the lines grouped under
 * their headings, one thing per line, in the order the work happens.
 *
 * "Do not add or remove anything" is in the instructions, and the instructions
 * are not the guarantee. Every reply is compared against what went in, line for
 * line, and thrown away if it does not match -- a scope that is quietly a
 * sentence shorter is worse than one that is untidy. When that happens, and
 * when there is no model to ask at all, the layout is done here by rule
 * instead: it moves text and hides bullet characters and cannot do anything
 * else, so it is always safe and usually enough.
 */
export async function tidyZoneScope(input: {
  scopeText: string;
  serviceLabel: string;
}): Promise<ScopeSuggestion> {
  const source = (input.scopeText ?? "").trim();

  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };
    if (!source) return { ok: false, message: "Write the scope first, then I will lay it out." };

    const byRule = tidyScope(source);
    if (!isAnthropicConfigured) return { ok: true, text: byRule };

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      // Grouping and ordering somebody else's sentences. The judgement is in
      // leaving them alone.
      output_config: { effort: "low" },
      system: tidySystemPrompt(),
      messages: [{ role: "user", content: tidyBrief(source, input.serviceLabel) }],
    });

    if (response.stop_reason === "refusal") return { ok: true, text: byRule };

    const text = cleanTidyText(
      response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
    );

    // The line that makes this safe to press. A reply that says anything other
    // than what it was given is not a layout, whatever it looks like.
    if (!text || !sameContent(source, text)) return { ok: true, text: byRule };

    return { ok: true, text };
  } catch {
    // Still worth doing without the model.
    const byRule = tidyScope(source);
    return byRule ? { ok: true, text: byRule } : { ok: false, message: "Couldn't lay it out just now." };
  }
}
