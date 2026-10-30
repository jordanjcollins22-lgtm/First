import type { ClientEstimate } from "@/lib/data/tap-estimate";
import { choiceLabel, dollars } from "@/lib/tap-estimate";

/**
 * On the job page: what the client was shown straight after the map
 * pre-evaluation, and whether the third down to hold it is in. The proposal
 * after the visit is the real price; this is what they are expecting.
 */
export function ClientEstimateCard({ estimate, clientHref, showMoney }: { estimate: ClientEstimate; clientHref: string; showMoney: boolean }) {
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
          Estimate <span className="font-semibold">{dollars(estimate.totalCents)}</span> ·{" "}
          {estimate.depositPaidAt
            ? `Deposit paid: ${dollars(estimate.depositCents)}`
            : estimate.acceptedAt
              ? `Accepted, deposit of ${dollars(estimate.depositCents)} not paid yet`
              : "Not accepted yet"}
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
