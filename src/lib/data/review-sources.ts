import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import {
  describePull,
  keepReview,
  pullDue,
  PLATFORM_LABEL,
  ReadReviewsSchema,
  REVIEW_READ_SYSTEM_PROMPT,
  reviewKey,
  reviewSourceFrom,
  type ReadReview,
  type ReviewPlatform,
} from "@/lib/review-import";

export interface ReviewSource {
  id: string;
  platform: ReviewPlatform;
  url: string;
  pullRequestedAt: string | null;
  pulledAt: string | null;
  lastResult: string | null;
  lastFound: number | null;
  lastKept: number | null;
}

export async function listReviewSources(organizationId: string): Promise<ReviewSource[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_review_sources")
    .select("id, platform, url, pull_requested_at, pulled_at, last_result, last_found, last_kept")
    .eq("organization_id", organizationId)
    .order("platform");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    url: r.url,
    pullRequestedAt: r.pull_requested_at,
    pulledAt: r.pulled_at,
    lastResult: r.last_result,
    lastFound: r.last_found,
    lastKept: r.last_kept,
  }));
}

/** The pages due a look, with where their reviews are, for the extension. */
export async function reviewSourcesDue(organizationId: string, now: Date = new Date()) {
  const sources = await listReviewSources(organizationId);
  return sources
    .filter((s) => pullDue(s, now))
    .map((s) => {
      const check = reviewSourceFrom(s.url);
      return check.ok ? { id: s.id, platform: s.platform, reviewsUrl: check.reviewsUrl } : null;
    })
    .filter((s): s is { id: string; platform: ReviewPlatform; reviewsUrl: string } => Boolean(s));
}

/**
 * The reviews off one page the extension read: picked out by the model,
 * only the five-star ones with something written kept, and none twice.
 */
export async function importReviews(
  organizationId: string,
  sourceId: string,
  pageText: string
): Promise<{ ok: true; found: number; fiveStar: number; added: number; said: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: source } = await supabase
    .from("booking_review_sources")
    .select("id, platform")
    .eq("organization_id", organizationId)
    .eq("id", sourceId)
    .maybeSingle();
  if (!source) return { ok: false, error: "That review page isn't set up any more." };

  const finish = async (said: string, found: number | null, kept: number | null) => {
    await supabase
      .from("booking_review_sources")
      .update({ pulled_at: new Date().toISOString(), last_result: said, last_found: found, last_kept: kept, updated_at: new Date().toISOString() })
      .eq("id", sourceId);
  };

  const text = pageText.trim();
  if (!text) {
    const said = describePull(0, 0, 0);
    await finish(said, 0, 0);
    return { ok: true, found: 0, fiveStar: 0, added: 0, said };
  }
  if (!isAnthropicConfigured) return { ok: false, error: "Reading reviews needs the AI key set up." };

  const read = await readReviews(source.platform, text);
  if (!read) {
    await finish("Couldn't read the reviews off the page this time. It tries again next week, or press Pull reviews.", null, null);
    return { ok: false, error: "Couldn't read the reviews off the page." };
  }

  const keep = read.filter((r) => keepReview(source.platform, r));
  const keyed = new Map<string, ReadReview>();
  for (const r of keep) keyed.set(reviewKey(source.platform, r), r);

  const keys = [...keyed.keys()];
  const [{ data: existing }, { data: dismissed }, { count }] = await Promise.all([
    keys.length > 0
      ? supabase.from("booking_proof").select("external_key").eq("organization_id", organizationId).in("external_key", keys)
      : Promise.resolve({ data: [] as { external_key: string | null }[] }),
    keys.length > 0
      ? supabase.from("booking_proof_dismissed").select("external_key").eq("organization_id", organizationId).in("external_key", keys)
      : Promise.resolve({ data: [] as { external_key: string }[] }),
    supabase.from("booking_proof").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("kind", "review"),
  ]);
  const skip = new Set([...(existing ?? []).map((r) => r.external_key), ...(dismissed ?? []).map((r) => r.external_key)]);

  let position = count ?? 0;
  const rows = [...keyed.entries()]
    .filter(([key]) => !skip.has(key))
    .map(([key, r]) => ({
      organization_id: organizationId,
      kind: "review" as const,
      author: r.author.trim().slice(0, 80),
      body: r.text.trim().slice(0, 1500),
      stars: r.stars === 5 ? 5 : null,
      source: PLATFORM_LABEL[source.platform as ReviewPlatform],
      external_key: key,
      source_id: sourceId,
      position: position++,
      shown: true,
    }));
  if (rows.length > 0) {
    const { error } = await supabase.from("booking_proof").insert(rows);
    if (error) {
      log.warn("reviews.insert_failed", { message: error.message });
      return { ok: false, error: error.message };
    }
  }

  const said = describePull(read.length, keyed.size, rows.length);
  await finish(said, read.length, keyed.size);
  return { ok: true, found: read.length, fiveStar: keyed.size, added: rows.length, said };
}

async function readReviews(platform: ReviewPlatform, pageText: string): Promise<ReadReview[] | null> {
  try {
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      // Copying reviews off a page is careful reading, not reasoning.
      output_config: { effort: "low", format: betaZodOutputFormat(ReadReviewsSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: REVIEW_READ_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `This is the reviews section of the business's ${PLATFORM_LABEL[platform]} page:\n\n<page>\n${pageText.slice(0, 120_000)}\n</page>`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    return response.parsed_output?.reviews ?? null;
  } catch (err) {
    log.warn("reviews.read_failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
