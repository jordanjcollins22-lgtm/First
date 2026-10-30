import type { ClientEstimate } from "@/lib/data/tap-estimate";
import { choiceLabel, dollars } from "@/lib/tap-estimate";

/**
 * On the job page: what the client was shown straight after the map
 * pre-evaluation, and how they paid before booking the visit: a third down
 * (with the basic evaluation), or a paid evaluation at one of the tiers. The
 * proposal after the visit is the real price; this is what they expect.
 */
export function ClientEstimateCard({
  estimate,
  tierName,
  clientHref,
  showMoney,
}: {
  estimate: ClientEstimate;
  /** The evaluation visit they get, by name. */
  tierName: string | null;
  clientHref: string;
  showMoney: boolean;
}) {
  const paid = estimate.chargedCents != null ? dollars(estimate.chargedCents) : "";
  const status = estimate.paidAt
    ? estimate.choice === "evaluation"
      ? `Paid evaluation: ${tierName ?? "evaluation"}, ${paid} (comes off the job)`
      : `Deposit paid: ${paid}, ${tierName ?? "basic evaluation"} included`
    : estimate.acceptedAt
      ? `Started paying (${estimate.choice === "evaluation" ? `${tierName ?? "evaluation"}` : "deposit"}), not paid yet`
      : "Hasn't paid yet";
  return (
    <section className="rounded-xl border border-primary/30 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Client&apos;s estimate</h2>
        <a href={clientHref} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">
          See what they see
        </a>
      </div>
      {showMoney && (
        <p className="text-sm">
          Estimate <span className="font-semibold">{dollars(estimate.totalCents)}</span> · {status}
        </p>
      )}
      <ol className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
        {estimate.spots.map((spot, i) => (
          <li key={i}>
            {i + 1}. {spot.choices.map(choiceLabel).join(", ")}
            {spot.photos.length > 0 ? ` (${spot.photos.length} photo${spot.photos.length === 1 ? "" : "s"})` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
