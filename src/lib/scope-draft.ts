
import Anthropic from "@anthropic-ai/sdk";

import { env, isAnthropicConfigured } from "@/lib/env";
import { briefFor, cleanScopeText, revisionBriefFor, revisionSystemPrompt, systemPrompt, type ZoneBrief } from "@/lib/scope-suggestion";

/**
 * One scope line from what the evaluator recorded, or a rewrite of one.
 *
 * Shared by the suggestion button and the review round, so the two never
 * drift into writing differently. Returns null when there is nothing to
 * give: no model configured, a refusal, or a reply the quantity filter
 * emptied.
 */
export async function draftScopeLine(zone: ZoneBrief, revision?: { previous: string; reason: string }): Promise<string | null> {
  if (!isAnthropicConfigured) return null;
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: revision ? revisionSystemPrompt() : systemPrompt(),
    messages: [{ role: "user", content: revision ? revisionBriefFor(zone, revision.previous, revision.reason) : briefFor(zone) }],
  });
  if (response.stop_reason === "refusal") return null;
  const raw = response.content.find((block) => block.type === "text")?.text ?? "";
  const text = cleanScopeText(raw);
  return text || null;
}
