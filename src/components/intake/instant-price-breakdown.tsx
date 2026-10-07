import { UNSEEN_PREMIUM, type InstantPrice } from "@/lib/instant-price";
import { cn } from "@/lib/utils";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const hours = (h: number) => (h < 10 ? h.toFixed(1) : Math.round(h).toString());

/**
 * The instant price with all of its working shown: each line's size, the
 * crew-hours, labour, materials and markup, then the unseen-yard premium
 * and the rounded total. Staff only. A figure that is a typical stand-in
 * rather than the business's own is marked, so it is plain what to set.
 */
export function InstantPriceBreakdown({ price }: { price: InstantPrice }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-3xl font-bold tabular-nums">{price.totalCents > 0 ? dollars(price.totalCents) : "Priced at the visit"}</p>
        <p className="text-xs text-muted-foreground">
          Sizes from {price.basis} and the parts of the yard they picked. Labour at {dollars(price.crewRateCents)} a crew-hour, marked up {price.markup}.
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {price.lines.map((line, i) => (
          <li key={`${line.label}-${i}`} className="rounded-lg border border-border bg-background/70 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">{line.label}</p>
              <p className="shrink-0 font-semibold tabular-nums">{line.priceCents != null ? dollars(line.priceCents) : "At the visit"}</p>
            </div>
            {line.priceAs && <p className="text-xs text-muted-foreground">Priced as {line.priceAs}</p>}
            {line.priceCents != null && (
              <dl className="mt-2 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-xs">
                {line.size && (
                  <>
                    <dt className="text-muted-foreground">Size</dt>
                    <dd>
                      {line.size}
                      {line.sizeFrom && <span className="text-muted-foreground"> · {line.sizeFrom}</span>}
                    </dd>
                    <dd />
                  </>
                )}
                <dt className="text-muted-foreground">Labour</dt>
                <dd>
                  {hours(line.crewHours)} crew-hours
                  {line.rate && <span className={cn(line.rateTypical ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}> · {line.rate}</span>}
                </dd>
                <dd className="text-right tabular-nums">{dollars(line.labourCents)}</dd>
                {line.materials.map((m) => (
                  <MaterialRow key={m.name} name={m.name} amount={m.amount} cents={m.cents} typical={m.typical} />
                ))}
                <dt className="text-muted-foreground">Markup</dt>
                <dd className="text-muted-foreground">and overhead</dd>
                <dd className="text-right tabular-nums">{dollars(line.markupCents)}</dd>
              </dl>
            )}
            {line.note && <p className="mt-1.5 text-xs text-muted-foreground">{line.note}</p>}
          </li>
        ))}
      </ol>

      {price.totalCents > 0 && (
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 border-t border-border pt-2 text-sm">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right tabular-nums">{dollars(price.subtotalCents)}</dd>
          <dt className="text-muted-foreground">Not seen yet, +{Math.round(UNSEEN_PREMIUM * 100)}%, rounded up to $25</dt>
          <dd className="text-right tabular-nums">{dollars(price.premiumCents)}</dd>
          <dt className="font-semibold">Phone quote</dt>
          <dd className="text-right font-semibold tabular-nums">{dollars(price.totalCents)}</dd>
        </dl>
      )}

      {price.usesTypical && (
        <p className="rounded-lg bg-amber-100/70 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Figures in amber are typical stand-ins, because the rate card or inventory has none yet. Set the service&apos;s timing
          in Services, or the material&apos;s cost in Inventory, and the price uses yours.
        </p>
      )}
    </div>
  );
}

function MaterialRow({ name, amount, cents, typical }: { name: string; amount: string; cents: number | null; typical: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">Material</dt>
      <dd>
        {name}, {amount}
        {typical && <span className="text-amber-700 dark:text-amber-400"> · typical cost</span>}
        {cents == null && <span className="text-amber-700 dark:text-amber-400"> · no cost set</span>}
      </dd>
      <dd className="text-right tabular-nums">{cents != null ? dollars(cents) : "–"}</dd>
    </>
  );
}
