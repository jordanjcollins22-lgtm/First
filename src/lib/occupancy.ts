/**
 * Owns or rents, said plainly at the top of the job, from the county data.
 *
 * It decides who can say yes to the work and who pays for it, and it was
 * buried in a popup on the county map. Maryland's assessment roll says
 * whether the owner claims the house as their principal residence; a house
 * the roll left unknown is settled from the State's own property record
 * page. Nobody is asked.
 */

export interface OccupancyFacts {
  /** The State's roll: owner lives there, or not, or unknown. */
  ownerOccupied: boolean | null;
  reason: string | null;
  ownerName?: string | null;
  /** True when there is no county house for this address at all. */
  noHouse?: boolean;
}

export interface OccupancyBadge {
  label: string;
  detail: string;
  tone: "good" | "warn" | "muted";
}

export function occupancyBadge(facts: OccupancyFacts): OccupancyBadge {
  if (facts.ownerOccupied === true) {
    return {
      label: "Owns the home",
      detail: facts.ownerName ? `${facts.ownerName}, per the State's roll.` : "Owner claims it as their principal residence, per the State's roll.",
      tone: "good",
    };
  }
  if (facts.ownerOccupied === false) {
    return {
      label: "Rents the home",
      detail: facts.ownerName
        ? `Owned by ${facts.ownerName}, who lives elsewhere. The owner may need to sign off on the work.`
        : `${facts.reason ?? "The owner lives elsewhere, per the State's roll."} The owner may need to sign off on the work.`,
      tone: "warn",
    };
  }
  if (facts.noHouse) return { label: "Own or rent? Not in the county data", detail: "No county house matches this address yet.", tone: "muted" };
  return { label: "Own or rent? Checking the State's roll", detail: "The roll left this one unknown; reading the State's property record.", tone: "muted" };
}
