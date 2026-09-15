import { money, valueInventory, type ValuedTool } from "@/lib/inventory-value";

/**
 * What the tools are worth, at the top of the page.
 *
 * Two numbers, because they answer two different questions and people used to
 * have to add up a column of eleven to get either. What is tied up in this
 * equipment, and what would it fetch if it went.
 *
 * The small print underneath is the honest part and is not optional. A total
 * that quietly leaves out nine tools nobody priced looks exactly like a total
 * that includes them, and the difference is however much those nine cost.
 */
export function InventoryValueSummary({
  tools,
  gear,
  containers,
}: {
  tools: readonly ValuedTool[];
  gear: readonly ValuedTool[];
  /** The bins and rigs the kits travel in, which are spending too. */
  containers: { count: number; value: number };
}) {
  const all = [...tools, ...gear];
  const total = valueInventory(all);
  if (all.length === 0 && containers.count === 0) return null;

  const equipment = valueInventory(tools);

  // Counted in what was spent, and left out of what it would fetch. A used
  // trash can on a dolly is worth what somebody will pay for a used trash can
  // on a dolly, which is nothing, and pretending otherwise inflates the one
  // number somebody would act on.
  const purchase = total.purchase + containers.value;

  const caveats: string[] = [];
  if (total.unpriced > 0) {
    caveats.push(
      `${total.unpriced} with no price on ${total.unpriced === 1 ? "it" : "them"} yet (${total.unpricedNames.join(", ")}${
        total.unpriced > total.unpricedNames.length ? " and more" : ""
      }), so both totals are short by whatever those cost.`
    );
  }
  if (containers.count > 0) {
    caveats.push(
      `Includes ${money(containers.value)} of kit containers (${containers.count}), counted in what was spent and left out of what it would fetch.`
    );
  }
  if (total.rentals > 0) {
    caveats.push(
      `${total.rentals} rented, in neither total${
        total.rentalBuyout > 0 ? ` — buying them outright would be about ${money(total.rentalBuyout)}` : ""
      }.`
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-border">
      <div className="grid grid-cols-2 divide-x divide-border">
        <Figure
          label="Purchase value"
          value={money(purchase)}
          detail={`What ${total.items} item${total.items === 1 ? "" : "s"} cost`}
        />
        <Figure
          label="Sell value"
          value={money(total.sell)}
          detail={
            purchase > 0
              ? `About ${Math.round((total.sell / purchase) * 100)}% back`
              : "What they would fetch"
          }
        />
      </div>

      {(gear.length > 0 || caveats.length > 0) && (
        <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {gear.length > 0 && (
            <p>
              Tools {money(equipment.purchase)} to buy, {money(equipment.sell)} back. Crew gear makes up
              the rest.
            </p>
          )}
          {caveats.map((line) => (
            <p key={line} className={gear.length > 0 ? "mt-1" : ""}>
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
