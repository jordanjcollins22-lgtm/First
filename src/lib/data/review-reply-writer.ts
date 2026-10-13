import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { env, isAnthropicConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import {
  fallbackReply,
  ReplySchema,
  replyBrief,
  replyProblems,
  replySystemPrompt,
  type ReviewForReply,
} from "@/lib/marketing/review-replies";

/**
 * A draft reply to one Google review, written the way the rest of the app
 * writes (social captions, PM emails): Claude with a structured answer,
 * checked by review-replies.ts, and the plain template whenever the check
 * fails or the model isn't there. Never throws.
 */
export async function draftReviewReply(review: ReviewForReply, businessName: string): Promise<{ reply: string; byModel: boolean }> {
  const fallback = () => ({ reply: fallbackReply(review, businessName), byModel: false });
  if (!isAnthropicConfigured) return fallback();
  try {
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: betaZodOutputFormat(ReplySchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: replySystemPrompt(businessName),
      messages: [{ role: "user", content: replyBrief(review) }],
    });
    const reply = response.stop_reason === "refusal" ? null : response.parsed_output?.reply?.trim();
    if (!reply) return fallback();
    const problems = replyProblems(reply, review);
    if (problems.length > 0) {
      log.warn("gbp.reply_refused", { problems });
      return fallback();
    }
    return { reply, byModel: true };
  } catch (err) {
    log.warn("gbp.reply_draft_failed", { error: err instanceof Error ? err.message : String(err) });
    return fallback();
  }
}
