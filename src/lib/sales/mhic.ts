/**
 * Maryland home-improvement rules for a proposal.
 *
 * The Maryland Home Improvement Commission (MHIC) licenses residential work
 * that goes beyond "mere landscaping": once earth is moved or something is
 * fixed to the ground (planting, a bed built, grading, drainage, stone,
 * irrigation), it is home improvement. Pure mowing, fertilizing and seeding
 * are not, and mulch on its own generally is not either. The rules that
 * follow from it, from labor.maryland.gov/license/mhic/mhiccontracts.shtml:
 *
 * - **No payment before the contract is signed.** On our proposals the
 *   client's Accept is the signature, so nothing is charged on a proposal
 *   that has not been accepted.
 * - **The deposit can't exceed one-third of the contract price.** After that
 *   the schedule is negotiable, so the rest is billed as the work is done.
 * - **The contract must carry set wording**: our MHIC number, the
 *   Commission's phone and website, the licensing notice, the Guaranty Fund
 *   notice and the performance-bond notice, with approximate start and
 *   completion dates and the agreed price.
 *
 * Bills to raise the cap to one-half were proposed in 2017 and 2020; the
 * Commission's page still says one-third, so one-third it is.
 *
 * This is a guard for the business, not legal advice. The wording below is
 * the research's summary of the required contents; the owner should have it
 * read once by whoever handles the licence.
 *
 * Pure, so the rules are tested without a database.
 */

/** The cap on a deposit for home-improvement work, as a fraction of the contract. */
export const MHIC_DEPOSIT_CAP = 1 / 3;

/**
 * The Commission's number as the research found it (Montgomery County OCP
 * citing MHIC). Check it against the contracts page before relying on it.
 */
export const MHIC_PHONE = "410-230-6001";
export const MHIC_WEBSITE = "www.labor.maryland.gov/license/mhic";

/**
 * Production-rate keys and service types that are home improvement. Listed
 * rather than guessed for the services the app prices, with a word match
 * for anything a business adds itself.
 */
const HOME_IMPROVEMENT_KEYS = new Set([
  // Production rates.
  "plant-install-1gal",
  "plant-install-3gal",
  "plant-relocation",
  "bush-removal-large",
  "rock-install",
  "material-removal",
  "bed-edging",
  "soil-prep",
  "topsoil-install",
  "hand-grading",
  "sod-install",
  // Rate-card service types.
  "landscape-bed",
  "plant-installation",
  "plant-bush-removal",
  "lawn-restoration",
  "grading",
]);

/** Exempt whatever the words say: the Commission's own example is a mower. */
const EXEMPT_KEYS = new Set([
  "mowing-edging",
  "lawn-care",
  "fertilization",
  "overseeding",
  "seeding",
  "aeration",
  "dethatching",
  "weed-pulling",
  "weed-spraying",
  "mulch-install",
  "leaf-removal",
  "leaf-removal-heavy",
  "leaf-seasonal-cleanup",
  "debris-cleanup",
  "landscape-cleanup",
  "perennial-cutback",
  "plant-cutback",
  "shrub-trimming",
  "tree-trimming",
  "trimming",
  "soft-washing",
  "gutter-cleaning",
  "snow-removal",
  "disposal",
]);

/** Whether one service is home-improvement work. */
export function isHomeImprovementService(keyOrTypeId: string, label = ""): boolean {
  if (HOME_IMPROVEMENT_KEYS.has(keyOrTypeId)) return true;
  if (EXEMPT_KEYS.has(keyOrTypeId)) return false;
  const words = `${keyOrTypeId} ${label}`.toLowerCase();
  if (/mow|fertili|seed|aerat|salt|snow|leaf|wash|gutter|cleanup|clean-up|trim|weed/.test(words) && !/install|hardscape|patio|wall|drain/.test(words)) return false;
  return /plant|install|hardscape|patio|paver|wall|grad|drain|irrigat|sprinkler|sod|stone|rock|bed|walkway|edging|excavat|french drain|lighting/.test(words);
}

export interface ScopeService {
  /** A production-rate key or a rate-card service type. */
  key: string;
  label?: string;
}

/** Whether a proposal's scope is home improvement: any one service makes it so. */
export function isHomeImprovementScope(services: ScopeService[]): boolean {
  return services.some((s) => isHomeImprovementService(s.key, s.label ?? ""));
}

/**
 * The scope's services from a proposal snapshot: each area's service label
 * and every priced line's key. What the client is shown is what decides it.
 */
export function servicesOfSnapshot(snapshot: { serviceLabel?: string | null; lines?: { key: string }[] | null }[] | null | undefined): ScopeService[] {
  const out: ScopeService[] = [];
  for (const zone of snapshot ?? []) {
    if (zone.serviceLabel) out.push({ key: zone.serviceLabel, label: zone.serviceLabel });
    for (const line of zone.lines ?? []) out.push({ key: line.key });
  }
  return out;
}

/** The most that can be taken at signing on this contract, in cents. */
export function depositCapCents(contractCents: number): number {
  if (!(contractCents > 0)) return 0;
  return Math.floor(Math.round(contractCents) * MHIC_DEPOSIT_CAP);
}

export interface DueAtSigning {
  /** What is charged now, in cents. */
  dueNowCents: number;
  /** What is billed later, as the work is done, in cents. */
  laterCents: number;
  /** Capped by MHIC: a deposit, not the whole price. */
  isDeposit: boolean;
  /** For the client, when it is a deposit. */
  note: string | null;
}

/**
 * What a client can be asked to pay at signing.
 *
 * Exempt work (mowing, a cleanup, snow) can be paid in full on accepting, as
 * it is today. Home-improvement work takes at most one-third now, or a
 * smaller deposit the business asked for, and the rest later.
 */
export function dueAtSigning(input: { contractCents: number; homeImprovement: boolean; requestedDepositCents?: number | null }): DueAtSigning {
  const total = Math.max(0, Math.round(input.contractCents));
  if (!input.homeImprovement) {
    return { dueNowCents: total, laterCents: 0, isDeposit: false, note: null };
  }
  const cap = depositCapCents(total);
  const asked = input.requestedDepositCents != null && input.requestedDepositCents > 0 ? Math.round(input.requestedDepositCents) : cap;
  const dueNow = Math.min(cap, asked);
  return {
    dueNowCents: dueNow,
    laterCents: total - dueNow,
    isDeposit: true,
    note: "Maryland home-improvement law caps the deposit at one-third of the contract price. The rest is billed as the work is done.",
  };
}

/**
 * What can be taken at signing on a proposal, straight from its snapshot:
 * the whole price for exempt work, at most a third for home improvement.
 * The one call the payment screens make, so they cannot disagree.
 */
export function atSigningForSnapshot(contractCents: number, snapshot: unknown): DueAtSigning {
  const zones = Array.isArray(snapshot) ? (snapshot as { serviceLabel?: string | null; lines?: { key: string }[] | null }[]) : [];
  return dueAtSigning({ contractCents, homeImprovement: isHomeImprovementScope(servicesOfSnapshot(zones)) });
}

/** Money can only be taken on an accepted (signed) proposal. */
export function mayTakePayment(proposalStatus: string | null | undefined): boolean {
  return proposalStatus === "accepted";
}

export interface ContractClause {
  heading: string;
  body: string;
}

export interface ContractDetails {
  businessName: string;
  businessAddress: string | null;
  /** Null when the licence number has not been entered: the block says so rather than printing a blank. */
  mhicLicense: string | null;
  /** Who sold it, when a salesperson did. */
  salesperson?: { name: string; license: string | null } | null;
  contractCents: number;
  /** Approximate start and substantial completion, in words. */
  startText?: string | null;
  completionText?: string | null;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The MHIC-required contract wording for a home-improvement proposal.
 *
 * Written plainly, as the rest of the proposal is, but complete: every item
 * the Commission lists is here. The arbitration clause is deliberately left
 * out because the business has none, and the lien notice because it takes no
 * lien; the block says so, so nobody reads the absence as an oversight.
 */
export function mhicContractClauses(details: ContractDetails): ContractClause[] {
  const licence = details.mhicLicense
    ? `MHIC licence number ${details.mhicLicense}`
    : "MHIC licence number to be added before signing";
  const who = [details.businessName, details.businessAddress].filter(Boolean).join(", ");
  const deposit = depositCapCents(details.contractCents);
  const clauses: ContractClause[] = [
    {
      heading: "Your contractor",
      body:
        `${who}. ${licence}.` +
        (details.salesperson ? ` Sold by ${details.salesperson.name}${details.salesperson.license ? `, salesperson licence ${details.salesperson.license}` : ""}.` : ""),
    },
    {
      heading: "Price and payment",
      body:
        `The agreed price is ${money(details.contractCents)}. No payment is taken before you sign. ` +
        `At signing we take a deposit of no more than one-third of the contract price (at most ${money(deposit)}), ` +
        "and the rest is billed as the work is done.",
    },
    {
      heading: "When the work happens",
      body:
        `Approximate start: ${details.startText?.trim() || "the date you pick after accepting"}. ` +
        `Approximate substantial completion: ${details.completionText?.trim() || "within the days booked for the work, weather allowing"}.`,
    },
    {
      heading: "Licensing notice",
      body:
        "Each contractor and each subcontractor must hold a current license from the Maryland Home Improvement Commission. " +
        `Any questions regarding a contractor or subcontractor should be directed to the Commission at ${MHIC_PHONE} or ${MHIC_WEBSITE}.`,
    },
    {
      heading: "Guaranty Fund and performance bond",
      body:
        "The Maryland Home Improvement Guaranty Fund may compensate homeowners for certain actual losses caused by a licensed contractor's " +
        "poor or incomplete work. You may also buy a performance bond for protection against losses not covered by the Guaranty Fund.",
    },
    {
      heading: "No arbitration clause and no lien",
      body:
        "This contract has no mandatory arbitration clause, and payment is not secured by a lien on your home. " +
        "You will get a signed copy of this contract before any work starts.",
    },
  ];
  return clauses;
}
