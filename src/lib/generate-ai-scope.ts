import { Anthropic } from "@anthropic-ai/sdk";
import type { WorkZone } from "@/components/canvas/types";
import { serviceTypeById } from "@/components/canvas/service-catalog";

/**
 * Generate an AI recommendation for what work should be done.
 *
 * If the API call fails for any reason, returns null silently so that
 * proposal generation doesn't block. The proposal can still be created
 * and sent without a recommendation.
 */
export async function generateRecommendedScope(
  zones: WorkZone[],
  organizationName: string
): Promise<string | null> {
  try {
    if (zones.length === 0) return null;

    // Build a summary of what will be done
    const zonesSummary = zones
      .filter((z) => z.service)
      .map((z) => {
        const def = serviceTypeById(z.service?.typeId ?? "");
        const service = def?.label || z.service?.typeId || "Service";
        const notes = z.service?.notes ? `Notes: ${z.service.notes}` : "";
        return `- ${z.name}: ${service}${notes ? ` (${notes})` : ""}`;
      })
      .join("\n");

    if (!zonesSummary) return null;

    const client = new Anthropic();

    const prompt = `Based on these work zones and notes, write a brief professional scope recommendation for a property evaluation proposal from ${organizationName}.

ZONES:
${zonesSummary}

Write 2-3 sentences recommending what work should be done and why. Focus on the benefit to the property owner. Do NOT:
- Use em dashes (–)
- Mention material quantities or specific amounts
- Include technical jargon
- Make it sound like a contract

Keep it warm, friendly, and focused on the outcome for the customer.`;

    const message = await client.messages.create({
      model: "claude-opus-4-1-20250805",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type === "text") {
      // Remove any remaining em dashes
      return content.text.replace(/–|—/g, "-");
    }

    return null;
  } catch (error) {
    // Log for debugging but don't throw - proposal generation should succeed
    // even if the recommendation fails
    console.error("Failed to generate recommended scope:", error instanceof Error ? error.message : error);
    return null;
  }
}
