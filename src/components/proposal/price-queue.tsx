"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { PriceCard } from "@/components/proposal/price-approvals";
import type { PriceApproval } from "@/lib/data/price-approvals";
import { cn } from "@/lib/utils";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * Every walkthrough whose proposal hasn't gone out, whatever day it was
 * done: one line each, and tapping it opens the full price underneath,
 * service by service with the photos, to accept and send.
 */
export function PriceQueue({ items, initialOpen = null }: { items: PriceApproval[]; initialOpen?: string | null }) {
  const [open, setOpen] = useState<string | null>(initialOpen ?? (items.length === 1 ? items[0].jobId : null));
  if (items.length === 0) return null;
  const toPrice = items.filter((i) => i.stage === "price").length;
  return (
    <section className="mb-6 flex flex-col gap-2" aria-labelledby="price-queue">
      <div>
        <h2 id="price-queue" className="text-lg font-bold">
          To price and send <span className="font-normal text-muted-foreground">({items.length})</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          {toPrice > 0 ? `${toPrice} waiting on a price` : "Priced"}
          {items.length - toPrice > 0 ? `${toPrice > 0 ? ", " : ""}${items.length - toPrice} priced and not sent yet` : ""}. Tap one to see the price service by service.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const on = open === item.jobId;
          return (
            <li key={item.jobId} id={`price-${item.jobId}`} className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setOpen(on ? null : item.jobId)}
                aria-expanded={on}
                className={cn("flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors", on ? "border-primary" : "border-border hover:border-primary/40")}
              >
                {on ? <ChevronDown className="h-4 w-4 shrink-0 text-primary" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{item.client}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.address}
                    {item.evaluator ? ` · ${item.evaluator}` : ""}
                    {item.submittedAt ? ` · ${new Date(item.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    item.stage === "price" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"
                  )}
                >
                  {item.stage === "price" ? "Ready to price" : "Ready to send"}
                </span>
                {item.stage === "send" && <span className="shrink-0 text-sm font-semibold tabular-nums">{dollars(item.totalCents)}</span>}
              </button>
              {on && <PriceCard item={item} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
