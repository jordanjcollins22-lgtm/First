import { kindOfSaved } from "@/lib/zone-measurement";

/**
 * Asking the evaluator for what the site map is missing.
 *
 * A proposal is priced off each area's size. An area drawn on the map and
 * never measured prices at nothing, and the office ends up typing a figure
 * in. So when the proposal is built and areas are unmeasured, the evaluator
 * gets one email listing exactly which ones and what to send back. Pure:
 * decides which areas and writes the email. Nothing here sends.
 */

export interface MeasurableZone {
  name: string;
  serviceLabel: string | null;
  /** How the service is priced: by area, by run length, by count, or a flat job. */
  basis: "area" | "perimeter" | "count" | "flat" | null;
  measurementKind?: "area" | "linear" | "none" | null;
  lengthFt?: number | null;
  widthFt?: number | null;
  areaSqFt?: number | null;
  perimeterFt?: number | null;
  /** A count-priced service's quantity, when typed. */
  quantity?: number | null;
}

/** The areas that cannot be priced as they stand. */
export function unmeasuredZones(zones: readonly MeasurableZone[]): MeasurableZone[] {
  return zones.filter((zone) => {
    if (!zone.serviceLabel) return false;
    if (zone.basis === "count") return !(zone.quantity && zone.quantity > 0);
    const kind = kindOfSaved(zone);
    if (kind === "linear") return !((zone.lengthFt ?? 0) > 0 || (zone.perimeterFt ?? 0) > 0);
    return !((zone.areaSqFt ?? 0) > 0 || ((zone.lengthFt ?? 0) > 0 && (zone.widthFt ?? 0) > 0));
  });
}

/** What to send back for one area, in the evaluator's terms. */
export function askFor(zone: MeasurableZone): string {
  if (zone.basis === "count") return "how many";
  if (zone.basis === "perimeter" || kindOfSaved(zone) === "linear") return "length in feet";
  if (zone.basis === "flat") return "length × width in feet, and roughly how long it will take";
  return "length × width in feet";
}

export function measurementRequestEmail(input: {
  evaluatorName: string | null;
  clientName: string;
  address: string;
  zones: readonly MeasurableZone[];
  jobLink: string;
  businessName: string;
}): { subject: string; text: string } {
  const shortAddress = input.address.split(",").slice(0, 2).join(",").trim();
  const first = (input.evaluatorName ?? "").trim().split(/\s+/)[0] || "there";
  const count = input.zones.length;
  const lines = input.zones.map((z) => `• ${z.name}${z.serviceLabel ? ` – ${z.serviceLabel}` : ""}: ${askFor(z)}`);
  const text = [
    `Hi ${first},`,
    "",
    `The proposal for ${input.clientName} at ${shortAddress} can't be priced yet: ${count === 1 ? "one area" : `${count} areas`} on the site map ${count === 1 ? "has" : "have"} no measurements.`,
    "",
    "Please send back, for each one:",
    ...lines,
    "",
    `Or open the job and tap each zone to type the measurements straight in: ${input.jobLink}`,
    "",
    "Thanks,",
    input.businessName,
  ].join("\n");
  return { subject: `Measurements needed: ${shortAddress} (${input.clientName})`, text };
}
