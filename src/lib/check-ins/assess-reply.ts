import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { serverEnv } from "@/lib/env";
import type { ReplyAssessment } from "@/types/domain";

const AssessmentSchema = z.object({
  assessment: z.enum(["on_track", "delayed", "blocked", "unclear"]),
  summary: z.string(),
});

export interface ReplyAssessmentResult {
  assessment: ReplyAssessment;
  summary: string;
}

const SYSTEM_PROMPT = `You review SMS replies from field crew members at a landscaping and property-services company. A manager texted them a scheduled check-in and you are reading their reply.

Classify the reply:
- on_track: they're on schedule, on site, or finished.
- delayed: running late, behind schedule, or the job will take longer than planned.
- blocked: they can't proceed (equipment broke, missing materials, no site access, weather stop, injury, or customer issue) or they're asking for help.
- unclear: the reply doesn't say how the work is going.

Write the summary as one short sentence a busy manager can skim. Include any time estimate they gave.`;

/**
 * Ask Claude how a crew member's check-in reply reads. Returns null when no
 * API key is configured or the call fails; the check-in still records the raw
 * reply either way.
 */
export async function assessReply(input: {
  checkInMessage: string;
  reply: string;
  memberName: string;
  jobName?: string | null;
}): Promise<ReplyAssessmentResult | null> {
  if (!serverEnv.anthropicApiKey) return null;

  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey });

  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AssessmentSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `Team member: ${input.memberName}`,
            input.jobName ? `Job: ${input.jobName}` : null,
            `Check-in we sent: ${input.checkInMessage}`,
            `Their reply: ${input.reply}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return response.parsed_output;
  } catch (error) {
    console.error("[check-ins] Claude reply assessment failed", error);
    return null;
  }
}
