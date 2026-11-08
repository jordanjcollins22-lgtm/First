import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { serverEnv } from "@/lib/env";

import { CATEGORIES, getCategory, LINE_BY_ID } from "./schedule-c";

const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as [string, ...string[]];

const SuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      id: z.string(),
      category: z.enum(CATEGORY_KEYS),
      confidence: z.number(),
      reason: z.string(),
    })
  ),
});

function categoryGuide() {
  return CATEGORIES.map((c) => {
    const where =
      c.target.kind === "line"
        ? `Schedule C line ${c.target.line} (${LINE_BY_ID.get(c.target.line)?.label})`
        : c.target.kind === "job_materials"
          ? "Part III line 36 or Part II line 22 (decided at year end)"
          : c.target.kind === "excluded"
            ? "not on Schedule C"
            : "unresolved";
    return `- ${c.key}: ${c.label}. ${c.help} [${where}]`;
  }).join("\n");
}

const SYSTEM_PROMPT = `You are a careful bookkeeper for a small landscaping and property-services company (plant installs, mulch, lawn care, pressure washing) that files IRS Schedule C. You categorize bank and credit-card transactions.

Rules:
- Pick exactly one category key from the list for each transaction.
- Be conservative. If a charge could easily be personal (groceries, retail, restaurants, streaming, Amazon) and nothing shows a business purpose, choose "personal" or "uncategorized", not a deduction. Overstating deductions creates audit risk.
- Plants, mulch, soil, stone, sod and similar landscape materials are "job_materials".
- Payments between the owner's own accounts, card payments, loans and income-tax payments are never income or expenses.
- Equipment or assets over $2,500 are "equipment_asset".
- confidence is 0 to 1. Use below 0.6 when you're guessing from a vague description.
- reason is a few words a bookkeeper would write.

Categories:
${categoryGuide()}`;

export interface AiInput {
  id: string;
  description: string;
  merchant_name: string | null;
  amount: number;
  posted_on: string;
}

export interface AiSuggestion {
  id: string;
  category: string;
  confidence: number;
  reason: string;
}

/**
 * Suggest categories for transactions the keyword rules couldn't place.
 * Returns [] when no API key is configured. Suggestions are never final:
 * the caller keeps them flagged for review.
 */
export async function suggestCategories(transactions: AiInput[]): Promise<AiSuggestion[]> {
  if (!serverEnv.anthropicApiKey || transactions.length === 0) return [];
  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey });

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(SuggestionSchema) },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "Categorize these transactions. Amount is positive for money in, negative for money out.\n\n" +
          transactions
            .map((t) => `${t.id} | ${t.posted_on} | ${t.amount.toFixed(2)} | ${t.merchant_name ? `${t.merchant_name} | ` : ""}${t.description}`)
            .join("\n"),
      },
    ],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) return [];
  const ids = new Set(transactions.map((t) => t.id));
  return response.parsed_output.suggestions
    .filter((s) => ids.has(s.id))
    .map((s) => ({ ...s, category: getCategory(s.category).key, confidence: Math.max(0, Math.min(1, s.confidence)) }));
}
