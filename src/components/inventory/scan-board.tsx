"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { recordMovement } from "@/lib/actions/inventory-tracking-actions";
import type { Movement } from "@/lib/inventory-usage";
import {
  averageRunDays,
  daysOfStockLeft,
  lastTakenBy,
  stillOut,
  usedPerDay,
} from "@/lib/inventory-usage";

interface ScanBoardProps {
  code: string;
  name: string;
  unit: string;
  kind: "tool" | "material" | "place";
  onHand: number | null;
  reorderThreshold: number | null;
  movements: Movement[];
  /** A place-code says how many should be there. */
  expectedQuantity: number | null;
  signedIn: boolean;
}

/**
 * What opens when somebody scans a sticker.
 *
 * The three things a person standing in the yard can do are the three big
 * buttons: took it, brought it back, counted it. Everything else on the page
 * is there to answer "is that right?" before they press one.
 */
export function ScanBoard({
  code,
  name,
  unit,
  kind,
  onHand,
  reorderThreshold,
  movements,
  expectedQuantity,
  signedIn,
}: ScanBoardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const out = stillOut(movements);
  const last = lastTakenBy(movements);
  const lifespan = averageRunDays(movements);
  const perDay = usedPerDay(movements);
  const left = onHand != null ? daysOfStockLeft(movements, onHand) : null;
  const low =
    onHand != null && reorderThreshold != null && onHand <= reorderThreshold;

  function submit(direction: "out" | "in" | "count") {
    setMessage(null);
    startTransition(async () => {
      const result = await recordMovement({ code, direction, quantity });
      setFailed(!result.ok);
      setMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-md px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {kind === "place" ? "Storage place" : kind === "tool" ? "Tool" : "Material"} · {code}
      </p>
      <h1 className="mt-1 text-2xl font-bold leading-tight">{name}</h1>

      <div className="mt-4 rounded-xl border border-white/60 bg-card/60 px-4 py-4 backdrop-blur-md">
        <p className="text-sm text-muted-foreground">On hand</p>
        <p className="text-4xl font-bold tabular-nums">
          {onHand ?? "—"}
          <span className="ml-2 text-base font-normal text-muted-foreground">{unit}</span>
        </p>
        {expectedQuantity != null && (
          <p className="mt-1 text-sm text-muted-foreground">
            This place should hold {expectedQuantity}.
          </p>
        )}
        {low && (
          <p className="mt-2 rounded-lg bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-700">
            At or below the reorder line ({reorderThreshold}).
          </p>
        )}
      </div>

      {kind !== "place" && (
        <>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-white/60 bg-card/60 px-3 py-2 backdrop-blur-md">
            <span className="text-sm font-medium">How many</span>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="One fewer"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center text-xl font-bold tabular-nums">{quantity}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="One more"
                onClick={() => setQuantity((q) => q + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            <Button
              type="button"
              className="h-14 text-base"
              disabled={pending || !signedIn}
              onClick={() => submit("out")}
            >
              <ArrowUpFromLine className="mr-2 h-5 w-5" />
              Take out
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-12"
                disabled={pending || !signedIn}
                onClick={() => submit("in")}
              >
                <ArrowDownToLine className="mr-2 h-4 w-4" />
                Put back
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12"
                disabled={pending || !signedIn}
                onClick={() => submit("count")}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                Count {quantity}
              </Button>
            </div>
          </div>

          {!signedIn && (
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in first — a movement needs a name on it.
            </p>
          )}
          {message && (
            <p
              className={`mt-2 rounded-lg px-3 py-2 text-sm ${
                failed ? "bg-red-500/15 text-red-700" : "bg-emerald-500/15 text-emerald-700"
              }`}
            >
              {message}
            </p>
          )}
        </>
      )}

      {out.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold">Out right now</h2>
          <ul className="space-y-1">
            {out.map((checkout, index) => (
              <li
                key={`${checkout.since}-${index}`}
                className="rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm backdrop-blur-md"
              >
                <span className="font-medium">{checkout.personName ?? "Someone"}</span>
                {checkout.quantity > 1 && ` · ${checkout.quantity}`}
                <span className="text-muted-foreground"> · since {shortDate(checkout.since)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {out.length === 0 && last && (
        <p className="mt-5 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm backdrop-blur-md">
          Last taken by <span className="font-medium">{last.personName ?? "someone"}</span> on{" "}
          {shortDate(last.happenedAt)}.
        </p>
      )}

      {(lifespan != null || perDay != null) && (
        <section className="mt-5 grid grid-cols-2 gap-2">
          {lifespan != null && (
            <Stat label="One lasts" value={`${lifespan.toFixed(0)} days`} />
          )}
          {perDay != null && (
            <Stat label="Used per day" value={`${round(perDay)} ${unit}`} />
          )}
          {left != null && <Stat label="Stock left" value={`${left.toFixed(0)} days`} />}
        </section>
      )}

      {movements.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold">History</h2>
          <ul className="space-y-1">
            {[...movements]
              .reverse()
              .slice(0, 20)
              .map((movement) => (
                <li
                  key={movement.id}
                  className="flex items-baseline justify-between rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm backdrop-blur-md"
                >
                  <span>
                    <span className="font-medium">{verb(movement.direction)}</span>{" "}
                    {movement.quantity} · {movement.personName ?? "someone"}
                  </span>
                  <span className="shrink-0 pl-2 text-xs text-muted-foreground">
                    {shortDate(movement.happenedAt)}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 px-3 py-2 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function verb(direction: Movement["direction"]): string {
  return direction === "out" ? "Took" : direction === "in" ? "Returned" : "Counted";
}

function round(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
