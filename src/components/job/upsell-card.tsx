import { INTAKE_QUESTIONS } from "@/lib/evaluation-intake";
import type { UpsellComparison } from "@/lib/instant-price";

const LABEL = new Map((INTAKE_QUESTIONS[0].options ?? []).map((o) => [o.value, o.label]));
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * What the client asked for on the pre-evaluation form beside what the
 * evaluator put on the site map. What nobody asked for is the evaluator's
 * find; what was asked for and is not on the map is worth a question.
 */
export function UpsellCard({ comparison, showMoney }: { comparison: UpsellComparison; showMoney: boolean }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-white/60 bg-card/60 p-4 text-sm backdrop-blur-md">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Asked for vs found</h2>
        {showMoney && comparison.addedCents > 0 && (
          <p className="text-xs font-medium text-emerald-700">+{dollars(comparison.addedCents)} found on the walk</p>
        )}
      </div>
      <p>
        <span className="text-muted-foreground">Asked for on the form: </span>
        {comparison.asked.length > 0 ? comparison.asked.map((s) => LABEL.get(s) ?? s).join(", ") : "nothing picked"}
      </p>
      <p>
        <span className="text-muted-foreground">Added by the evaluator: </span>
        {comparison.added.length > 0
          ? comparison.added.map((a) => (showMoney ? `${a.label} (${dollars(a.priceCents)})` : a.label)).join(", ")
          : "nothing beyond what they asked for"}
      </p>
      {comparison.notOnMap.length > 0 && (
        <p className="text-amber-700">
          <span className="text-muted-foreground">Asked for, not on the site map: </span>
          {comparison.notOnMap.map((s) => LABEL.get(s) ?? s).join(", ")}
        </p>
      )}
    </section>
  );
}
