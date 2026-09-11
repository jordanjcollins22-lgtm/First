import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getSaltBoard } from "@/lib/data/salt-orders";
import { money, SURFACE_LABEL } from "@/lib/salt";

/**
 * Salt Route.
 *
 * Two questions, answered together because the office asks them together.
 * Who is on the round, and what still has to be bought to cover them.
 *
 * The buying figure is worked out from treatments still owed rather than
 * treatments sold, so a season half delivered stops asking for product that is
 * already on the ground. The pet safe bags are counted separately rather than
 * added in: it is a different bag at a different price that cannot be
 * substituted, and one number would send somebody to the supplier with the
 * wrong basket.
 */
export const dynamic = "force-dynamic";

export default async function SaltPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("salt", "/more");

  const board = await getSaltBoard().catch((err) => {
    console.error("Salt route failed to load:", err);
    return null;
  });

  if (!board) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Couldn&apos;t read the salt orders just now. Reload the page.
        </p>
      </div>
    );
  }

  const paid = board.orders.filter((order) => order.status === "paid");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Salt Route</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone who has prepaid a winter, and what it takes to cover them. Paid orders are
          already on the schedule as approved work.
        </p>
      </header>

      <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
        <Figure label="Prepaid" value={money(board.takenCents)} detail={`${paid.length} orders`} />
        <Figure
          label="Treatments owed"
          value={String(board.buying.outstanding)}
          detail={`of ${board.soldTreatments} sold`}
        />
        <Figure
          label="Product to buy"
          value={money(board.buying.totalCostCents)}
          detail={`${board.buying.standardBags + board.buying.petBags} bags`}
        />
      </div>

      {board.unplaced > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-50/70 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
          <span>
            {board.unplaced} paid order{board.unplaced === 1 ? "" : "s"} could not be placed on the
            map, so there is no property or job for{" "}
            {board.unplaced === 1 ? "it" : "them"} yet. The money is taken and the order stands.
            Add the address by hand and it joins the round.
          </span>
        </p>
      )}

      <section className="rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">What to order</h2>
          <p className="text-xs text-muted-foreground">
            Enough to cover every treatment still owed. Bags are rounded up, because half a bag is
            not something anybody can order.
          </p>
        </div>
        <ul className="divide-y divide-border">
          <Buy
            label="Calcium chloride"
            bags={board.buying.standardBags}
            pounds={board.buying.standardPounds}
            cost={board.buying.standardCostCents}
            bagPounds={board.settings.bagPounds}
          />
          <Buy
            label="Pet safe blend"
            bags={board.buying.petBags}
            pounds={board.buying.petPounds}
            cost={board.buying.petCostCents}
            bagPounds={board.settings.bagPounds}
          />
        </ul>
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Priced at {money(board.settings.bagCostCents)} a bag, and{" "}
          {money(board.settings.petBagCostCents)} for the pet safe. Those two figures are what
          every price on the order form is built from, so check them against a real supplier
          invoice before the season.
        </p>
      </section>

      <section className="rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">The round</h2>
          <p className="text-xs text-muted-foreground">
            Paid first. An unpaid row is somebody who opened the card form and closed it.
          </p>
        </div>
        {board.orders.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            Nobody has booked yet. Send them the link and it fills in on its own.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {board.orders.map((order) => (
              <li key={order.id} className="p-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{order.name}</span>
                  {order.status !== "paid" && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      not paid
                    </span>
                  )}
                  {order.needsPlacing && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                      address needs placing
                    </span>
                  )}
                  <span className="ml-auto text-sm font-semibold tabular-nums">
                    {money(order.amountCents)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{order.address}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {SURFACE_LABEL[order.surface]}
                  {order.petFriendly && ", pet safe"} · {order.treatments - order.used} of{" "}
                  {order.treatments} left · {order.email}
                  {order.phone && ` · ${order.phone}`}
                </p>
                {order.jobId && (
                  <Link href={`/jobs/${order.jobId}`} className="text-xs underline">
                    Open the job
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        The form lives at <span className="font-medium">/salt</span>. Send that link to anybody and
        they can book and pay without an account.
      </p>
    </div>
  );
}

function Buy({
  label,
  bags,
  pounds,
  cost,
  bagPounds,
}: {
  label: string;
  bags: number;
  pounds: number;
  cost: number;
  bagPounds: number;
}) {
  return (
    <li className="flex items-baseline justify-between gap-2 px-3 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {bags === 0 ? "Nothing owed" : `${bags} × ${bagPounds} lb bag, covering ${pounds} lb`}
        </p>
      </div>
      <span className="text-sm font-semibold tabular-nums">{money(cost)}</span>
    </li>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
