import type { QuoteCheck } from "./ai";
import type { SubcontractingAssessment } from "./types";

/**
 * Pick the sub to bid with: the lowest price that fully covers the scope
 * (and, where the limitations-on-subcontracting clause bites, a sub that is
 * small and self-performs so 100% pass-through stays compliant).
 */
export interface QuoteForSelection {
  id: string;
  amount: number;
  compliance: QuoteCheck | null;
  is_small_business: boolean | null;
  uses_own_employees: boolean | null;
  accepts_net30: boolean | null;
  down_payment_pct: number | null;
}

export interface QuoteSelection<Q extends QuoteForSelection> {
  chosen: Q | null;
  /** Why each other quote was passed over. */
  rejected: Array<{ quote: Q; reason: string }>;
  warnings: string[];
}

export function selectBestQuote<Q extends QuoteForSelection>(
  quotes: Q[],
  subcontracting: Pick<SubcontractingAssessment, "status"> | null
): QuoteSelection<Q> {
  const rejected: QuoteSelection<Q>["rejected"] = [];
  const warnings: string[] = [];
  const needsSse = subcontracting?.status === "similarly_situated_required";

  const eligible = quotes.filter((q) => {
    if (!(q.amount > 0)) {
      rejected.push({ quote: q, reason: "No price" });
      return false;
    }
    if (q.compliance && !q.compliance.compliant) {
      const why = [...q.compliance.gaps, ...q.compliance.substitutions].slice(0, 3).join("; ");
      rejected.push({ quote: q, reason: `Doesn't match the scope${why ? `: ${why}` : ""}` });
      return false;
    }
    if (needsSse && !(q.is_small_business && q.uses_own_employees)) {
      rejected.push({ quote: q, reason: "Not confirmed small + self-performing (required to sub out 100% under 52.219-14)" });
      return false;
    }
    return true;
  });

  // Checked-and-compliant beats unchecked; then lowest price.
  eligible.sort(
    (a, b) => Number(a.compliance?.compliant !== true) - Number(b.compliance?.compliant !== true) || a.amount - b.amount
  );
  const chosen = eligible[0] ?? null;
  for (const q of eligible.slice(1)) rejected.push({ quote: q, reason: "Higher price" });

  if (chosen) {
    if (!chosen.compliance) warnings.push("Quote wasn't AI-checked against the scope — review it line by line before submitting.");
    if (chosen.accepts_net30 === false || (chosen.down_payment_pct ?? 0) > 0) {
      warnings.push(
        `Sub wants ${chosen.down_payment_pct ? `${chosen.down_payment_pct}% down` : "faster than net-30 payment"} — plan cash flow (government pays net 30 after acceptance).`
      );
    }
    if (eligible.length === 1 && quotes.length < 2) warnings.push("Only one quote — consider waiting for another to confirm the price.");
  }
  return { chosen, rejected, warnings };
}
