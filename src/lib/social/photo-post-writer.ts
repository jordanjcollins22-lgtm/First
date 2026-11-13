import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { env, isAnthropicConfigured } from "@/lib/env";
import { CaptionSchema, captionBrief, captionSystemPrompt, type CaptionArea } from "@/lib/social-caption";
import { draftProblems, partsToPlanText } from "@/lib/social/photo-drafts";
import type { PlanText } from "@/lib/social-plan";

/**
 * The AI caption writer for a photo draft, the same writer and the same
 * privacy rules as Write caption in the studio (writeSocialCaption). The
 * writer is told the service, the details and the town and zip only, never
 * the client or the street, and what comes back is scrubbed and checked.
 *
 * Null when the writer isn't set up (only production has the key), can't be
 * reached, or wrote something that fails the checks: the caller then uses
 * the template.
 */
export type DraftWriter = (input: {
  businessName: string;
  service: string;
  details: string[];
  area: CaptionArea | null;
  phone: string;
  bookingUrl: string;
  privateTerms: string[];
}) => Promise<PlanText | null>;

export const writeDraftText: DraftWriter = async (input) => {
  if (!isAnthropicConfigured) return null;
  try {
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: betaZodOutputFormat(CaptionSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: captionSystemPrompt(input.businessName),
      messages: [
        {
          role: "user",
          content: captionBrief({ service: input.service, details: input.details, sizeLabel: null, area: input.area, phone: input.phone, bookingUrl: input.bookingUrl }),
        },
      ],
    });
    const parts = response.stop_reason === "refusal" ? null : response.parsed_output;
    if (!parts) return null;
    const text = partsToPlanText(parts, input.privateTerms);
    if (draftProblems(text, input.privateTerms).length) return null;
    return text;
  } catch (err) {
    console.error("photo draft writer failed:", err);
    return null;
  }
};
