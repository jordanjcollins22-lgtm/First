import { resaleReason, resaleValue } from "@/lib/resale";

/**
 * What we would get back for it, or why there is nothing to get back.
 *
 * A dash with a reason rather than a zero. Zero reads as "worth nothing",
 * which is a different and wronger claim than "not a thing you can sell" —
 * and it is the claim somebody would act on when deciding whether to bother
 * listing the old mower.
 */
export function ResaleCell({
  cost,
  override,
  isRental,
  isOther,
}: {
  cost: number | null;
  override?: number | null;
  isRental?: boolean;
  isOther?: boolean;
}) {
  const value = resaleValue({ cost, override, isRental, isOther });
  if (value == null) {
    return (
      <span className="text-xs text-muted-foreground" title={resaleReason({ cost, isRental, isOther }) ?? ""}>
        —
      </span>
    );
  }

  return (
    <span className="text-sm tabular-nums" title={override != null ? "Set by hand" : "About a tenth of cost"}>
      {value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
    </span>
  );
}
