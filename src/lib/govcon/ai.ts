import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * Claude does the reading a human broker would do by hand:
 *  1. analyzeSolicitation — read the solicitation + SOW + wage determination,
 *     pull out what matters for bid/no-bid, and write a clean, sub-facing
 *     scope of work (no contract numbers or contracting-officer contacts).
 *  2. checkQuote — compare a sub's quote to the scope ("they quoted a 12-ton
 *     unit, the SOW says 14-ton").
 *  3. draftProposal — price, technical approach and past performance
 *     volumes from the evaluation criteria and the chosen sub's quote.
 *
 * Server-side fallback is enabled so a safety-classifier decline on one
 * model retries on another instead of stalling the pipeline.
 */
const MODEL = "claude-opus-5-5";
const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export const isAiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export type SolicitationDocument =
  | { name: string; kind: "pdf"; base64: string }
  | { name: string; kind: "text"; text: string };

function documentBlocks(docs: SolicitationDocument[]): Anthropic.Beta.BetaContentBlockParam[] {
  return docs.map((d) =>
    d.kind === "pdf"
      ? {
          type: "document" as const,
          title: d.name,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: d.base64 },
        }
      : {
          type: "document" as const,
          title: d.name,
          source: { type: "text" as const, media_type: "text/plain" as const, data: d.text },
        }
  );
}

async function parseWith<T extends z.ZodType>(
  schema: T,
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  effort: "low" | "medium" | "high" = "medium"
): Promise<z.infer<T>> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    system,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined: ${response.stop_details?.explanation ?? "refusal"}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Model output was truncated (max_tokens)");
  if (!response.parsed_output) throw new Error("Model returned no structured output");
  return response.parsed_output as z.infer<T>;
}

// ---------------------------------------------------------------------------
// 1. Solicitation analysis
// ---------------------------------------------------------------------------

export const SolicitationAnalysisSchema = z.object({
  brokerable: z
    .boolean()
    .describe("True if a single local small business (or two) could quote and perform this from the documents, with us acting only as prime/project manager."),
  brokerableReason: z.string(),
  scopeSummary: z.string().describe("3-6 sentence internal summary of the work, quantities, frequency and period."),
  subScopeOfWork: z
    .string()
    .describe(
      "Markdown scope of work to send to prospective subcontractors. Include the site address, every task, quantities, frequencies, standards, schedule/period, materials, insurance/license/badging requirements, and that SCA wage-determination rates apply if a WD is attached (give the WD number and key occupation rates). EXCLUDE the solicitation/notice number, agency contacts, contracting officer names/emails/phones, and how to submit to the government."
    ),
  siteAddress: z.object({
    facilityName: z.string().nullable(),
    street: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable().describe("2-letter US state code"),
    zip: z.string().nullable(),
  }),
  periodOfPerformance: z.object({
    description: z.string(),
    baseMonths: z.number().nullable(),
    optionPeriods: z.number().nullable(),
    startDate: z.string().nullable(),
  }),
  evaluation: z.object({
    method: z.enum(["lowest_price", "lpta", "best_value_tradeoff", "other", "unknown"]),
    factors: z.array(z.string()),
    pastPerformanceRequired: z.boolean(),
    technicalVolumeRequired: z.boolean(),
  }),
  submission: z.object({
    method: z.enum(["email", "portal", "piee", "mail", "other", "unknown"]),
    address: z.string().nullable().describe("Email address or portal URL proposals go to"),
    instructions: z.string(),
    questionsDeadline: z.string().nullable(),
    pageLimits: z.string().nullable(),
  }),
  requiredProposalContents: z.array(z.string()).describe("Every item the offeror must submit (forms, SF1449 blocks, reps & certs, price schedule, volumes)."),
  siteVisit: z.object({
    offered: z.boolean(),
    mandatory: z.boolean(),
    details: z.string().nullable(),
  }),
  limitationsOnSubcontractingClause: z.boolean().describe("True if FAR 52.219-14 (Limitations on Subcontracting) is included."),
  wageDetermination: z.string().nullable().describe("SCA WD number and revision, if any"),
  estimatedValue: z.number().nullable().describe("Government estimate / magnitude in dollars, if stated (total, all periods)"),
  priceLines: z
    .array(z.object({ clin: z.string().nullable(), description: z.string(), quantity: z.number().nullable(), unit: z.string().nullable() }))
    .describe("Line items the offeror must price"),
  redFlags: z.array(z.string()).describe("Anything that makes brokering risky: bonding, clearances, on-site supervisor, key personnel, mandatory site visit, 24/7 response, AbilityOne, incumbent workforce, licensing, equipment purchases."),
  recommendation: z.enum(["bid", "no_bid"]),
  recommendationReason: z.string(),
});
export type SolicitationAnalysis = z.infer<typeof SolicitationAnalysisSchema>;

const ANALYZE_SYSTEM = `You analyze US government solicitations for a small business that bids as the prime contractor and subcontracts the physical work to a local small business near the job site, managing the contract itself (scheduling, quality control, invoicing, government communication).

Read every document provided. Be literal and specific: quote quantities, frequencies, dates and requirements from the documents rather than paraphrasing loosely. If something isn't stated, use null rather than guessing.

Recommend no_bid when the work can't realistically be quoted by a local sub from these documents, when it requires something the prime itself must have (security clearance, bonding we can't get, a full-time on-site employee of the prime, specialized licensing held by the prime), or when the submission requirements can't be met in time.`;

export async function analyzeSolicitation(input: {
  title: string;
  noticeText: string;
  documents: SolicitationDocument[];
}): Promise<SolicitationAnalysis> {
  return parseWith(SolicitationAnalysisSchema, ANALYZE_SYSTEM, [
    ...documentBlocks(input.documents),
    {
      type: "text",
      text: `Notice title: ${input.title}\n\nNotice description:\n${input.noticeText.slice(0, 40_000)}\n\nAnalyze this solicitation.`,
    },
  ]);
}

// ---------------------------------------------------------------------------
// 2. Quote compliance check
// ---------------------------------------------------------------------------

export const QuoteCheckSchema = z.object({
  compliant: z.boolean().describe("True only if the quote covers the full scope with no material gaps or substitutions."),
  coveragePct: z.number().describe("0-100 estimate of how much of the scope the quote covers"),
  gaps: z.array(z.string()).describe("Scope items missing or under-specified in the quote"),
  substitutions: z.array(z.string()).describe("Places the quote differs from the spec (e.g. 12-ton vs 14-ton unit, fewer mow cycles)"),
  exclusions: z.array(z.string()).describe("Explicit exclusions/assumptions in the quote"),
  periodsCovered: z.string().describe("Which periods (base/options) the price covers"),
  totalPrice: z.number().nullable().describe("Total price for all periods the quote covers, if determinable"),
  summary: z.string(),
});
export type QuoteCheck = z.infer<typeof QuoteCheckSchema>;

export async function checkQuote(input: {
  subScopeOfWork: string;
  quotedAmount: number;
  quoteNotes: string | null;
  quoteDocument: SolicitationDocument | null;
}): Promise<QuoteCheck> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.quoteDocument) content.push(...documentBlocks([input.quoteDocument]));
  content.push({
    type: "text",
    text: `SCOPE OF WORK SENT TO THE SUBCONTRACTOR:\n${input.subScopeOfWork}\n\nSUBCONTRACTOR'S QUOTED PRICE: $${input.quotedAmount.toLocaleString()}\nSUBCONTRACTOR'S NOTES:\n${input.quoteNotes ?? "(none)"}\n\nDoes this quote fully match the scope?`,
  });
  return parseWith(
    QuoteCheckSchema,
    "You review subcontractor quotes against a government scope of work for a prime contractor. Flag every gap, substitution, exclusion or missing period — anything that would leave the prime unable to deliver the full scope at the quoted price. Be strict: a quote with material gaps is not compliant.",
    content,
    "medium"
  );
}

// ---------------------------------------------------------------------------
// 3. Proposal drafting
// ---------------------------------------------------------------------------

export const ProposalDraftSchema = z.object({
  coverLetter: z.string().describe("Markdown cover letter to the contracting officer"),
  technicalApproach: z.string().describe("Markdown technical capability / approach volume, addressing each evaluation factor"),
  pastPerformance: z.string().describe("Markdown past performance volume built from the references provided"),
  priceNarrative: z.string().describe("Markdown price volume narrative and line-item table"),
  submissionChecklist: z.array(z.string()).describe("Everything that must be attached/completed before submitting, from the solicitation"),
  assumptions: z.array(z.string()),
});
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;

export async function draftProposal(input: {
  company: { name: string; uei: string | null; cage: string | null; address: string | null; contactName: string | null; email: string | null; phone: string | null };
  solicitation: { title: string; number: string | null; agency: string | null };
  analysis: SolicitationAnalysis;
  subcontractor: { name: string; references: string | null; yearsInBusiness: string | null };
  price: { total: number; lines: Array<{ description: string; amount: number }> };
}): Promise<ProposalDraft> {
  return parseWith(
    ProposalDraftSchema,
    `You write concise, compliant proposals for a small business prime contractor that performs government service contracts with a local subcontractor while managing the work itself (scheduling, quality control, inspections, invoicing, single point of contact for the government). Follow the solicitation's evaluation criteria and required contents exactly. Never invent past performance, certifications, licenses or facts not provided — leave a clearly marked [PLACEHOLDER] where information is missing. Describe the subcontractor as a teaming partner where the solicitation allows; be truthful that the prime will subcontract.`,
    [
      {
        type: "text",
        text: JSON.stringify(input, null, 2),
      },
    ],
    "high"
  );
}
