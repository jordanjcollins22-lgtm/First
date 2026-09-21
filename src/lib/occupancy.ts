/**
 * Owns or rents, said plainly at the top of the job.
 *
 * It decides who can say yes to the work and who pays for it, and it was
 * buried in a popup on the county map. What the client told us wins; the
 * State's roll, which says whether the owner claims the house as their
 * principal residence, fills in when nobody asked.
 */

export type Occupancy = "owner" | "renter";

export interface OccupancyFacts {
  /** What the client said, when somebody asked. */
  told: Occupancy | null;
  /** The State's roll: owner lives there, or not, or unknown. */
  rollOwnerOccupied: boolean | null;
  rollReason: string | null;
}

export interface OccupancyBadge {
  label: string;
  detail: string;
  tone: "good" | "warn" | "muted";
  /** Where the answer came from. */
  source: "client" | "roll" | "none";
}

export function occupancyBadge(facts: OccupancyFacts): OccupancyBadge {
  if (facts.told === "owner") return { label: "Owns the home", detail: "The client told us.", tone: "good", source: "client" };
  if (facts.told === "renter") {
    return { label: "Rents the home", detail: "The client told us. The owner may need to sign off on the work.", tone: "warn", source: "client" };
  }
  if (facts.rollOwnerOccupied === true) {
    return { label: "Owns the home", detail: facts.rollReason ?? "The State's roll says the owner lives here.", tone: "good", source: "roll" };
  }
  if (facts.rollOwnerOccupied === false) {
    return {
      label: "Likely rents",
      detail: `${facts.rollReason ?? "The owner lives elsewhere, by the State's roll."} Worth asking.`,
      tone: "warn",
      source: "roll",
    };
  }
  return { label: "Own or rent? Not known", detail: "Ask, and tap the answer here.", tone: "muted", source: "none" };
}
