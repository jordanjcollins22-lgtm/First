"use server";

import Anthropic from "@anthropic-ai/sdk";

import { env, isAnthropicConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { listJobMessages } from "@/lib/data/job-messages";
import { viewsForJob } from "@/lib/data/proposal-views";
import { activityLabel } from "@/lib/proposal-views";
import { pipelinePosition } from "@/lib/pipeline";
import {
  contextBlock,
  fallbackSuggestions,
  parseSuggestions,
  safeSuggestions,
  systemPrompt,
  type NudgeContext,
  type ThreadLine,
} from "@/lib/suggested-replies";

export type SuggestResponse =
  | { ok: true; suggestions: string[]; wroteBy: "model" | "rules" }
  | { ok: false; message: string };

/** How much of the thread the model reads. Enough for the shape of the
 * conversation, not so much that a two-year customer costs a fortune to
 * suggest a reply to. */
const THREAD_WINDOW = 20;

/**
 * Drafts of what to say next on one job.
 *
 * It suggests and stops. Nothing here sends a message, books a day, changes a
 * status or touches the proposal — a person reads the drafts, picks one or
 * ignores them all, edits it, and presses send. That is deliberate: these
 * conversations carry prices and commitments, and an agent that could send on
 * its own would have to be trusted with both.
 *
 * Falls back to rule-written drafts when there is no API key or the call
 * fails, because a suggestion that appears instantly and needs one edit is
 * worth more than a better one that never arrives.
 */
export async function suggestReplies(jobId: string): Promise<SuggestResponse> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const context = await gatherContext(jobId);
    if (!context) return { ok: false, message: "Couldn't read this job." };

    const now = new Date();
    const facts = contextBlock(context, now);

    if (!isAnthropicConfigured) {
      return { ok: true, suggestions: fallbackSuggestions(context, now), wroteBy: "rules" };
    }

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      // Short drafts from a small brief. The thinking is in choosing the
      // angle, not in the writing.
      output_config: { effort: "low" },
      system: systemPrompt(),
      messages: [{ role: "user", content: facts }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: true, suggestions: fallbackSuggestions(context, now), wroteBy: "rules" };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    // The price guard runs on the way out, not as an instruction the model is
    // trusted to have followed.
    const suggestions = safeSuggestions(parseSuggestions(text), facts);
    if (suggestions.length === 0) {
      return { ok: true, suggestions: fallbackSuggestions(context, now), wroteBy: "rules" };
    }

    return { ok: true, suggestions, wroteBy: "model" };
  } catch {
    // A model that is down is not a reason for an empty panel.
    try {
      const context = await gatherContext(jobId);
      if (context) {
        return { ok: true, suggestions: fallbackSuggestions(context, new Date()), wroteBy: "rules" };
      }
    } catch {
      // Fall through to the message below.
    }
    return { ok: false, message: "Couldn't write a suggestion just now." };
  }
}

/**
 * The most recent project and everything said on it.
 *
 * Read with the signed-in user's client, so row level security decides what
 * the agent can see — it has no more reach than the person asking it.
 */
async function gatherContext(jobId: string): Promise<NudgeContext | null> {
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, evaluation_status, evaluation_date, project_start_date, project_end_date, property_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const [{ data: property }, { data: proposal }, external, internal, views] = await Promise.all([
    supabase.from("properties").select("address, customer_id").eq("id", job.property_id).maybeSingle(),
    supabase
      .from("job_proposals")
      .select("status, total_cost, paid_at")
      .eq("job_id", jobId)
      .maybeSingle(),
    listJobMessages(jobId, "external"),
    listJobMessages(jobId, "internal"),
    viewsForJob(jobId).catch(() => null),
  ]);

  const { data: customer } = property
    ? await supabase.from("customers").select("name").eq("id", property.customer_id).maybeSingle()
    : { data: null };

  const position = pipelinePosition({
    status: job.status,
    evaluationStatus: job.evaluation_status,
    evaluationDate: job.evaluation_date,
    projectStartDate: job.project_start_date,
    projectEndDate: job.project_end_date,
    proposalStatus: proposal?.status ?? null,
  });

  // Both sides of the thread, in the order they were said. An internal note
  // is often where the reason for the silence is written down.
  const recentMessages: ThreadLine[] = [...external, ...internal]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-THREAD_WINDOW)
    .map((message) => ({
      from: message.author_type === "client" ? "client" : "team",
      body: message.reference_label ? `(about ${message.reference_label}) ${message.body}` : message.body,
      at: message.created_at,
    }));

  return {
    customerName: customer?.name ?? "",
    propertyAddress: property?.address ?? "",
    stage: position.status || position.stage,
    dueNext: null,
    proposalStatus: proposal?.status ?? null,
    proposalTotalCents:
      proposal?.total_cost != null ? Math.round(proposal.total_cost * 100) : null,
    proposalActivity: views ? activityLabel(views, new Date()) : null,
    paid: Boolean(proposal?.paid_at),
    startDate: job.project_start_date,
    recentMessages,
  };
}
