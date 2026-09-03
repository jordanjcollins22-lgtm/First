import { Anthropic } from "@anthropic-ai/sdk";
import type { WorkZone } from "@/components/canvas/types";
import { serviceTypeById } from "@/components/canvas/service-catalog";

export async function generateRecommendedScope(
  zones: WorkZone[],
  organizationName: string
): Promise<string | null> {
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

  try {
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
  } catch (error) {
    console.error("Failed to generate recommended scope:", error);
  }

  return null;
}
