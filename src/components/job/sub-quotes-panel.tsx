"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/groups/copy-button";
import { closeSubQuoteRequest, createSubQuoteRequest } from "@/lib/actions/sub-quote-actions";
import { SUB_QUOTE_STATUS_LABEL, type ServiceGroup } from "@/lib/sub-quotes";
import type { SubQuoteRequestRow } from "@/lib/data/sub-quotes";
import { dateShort } from "@/lib/time-zone";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Get a subcontractor's price for one service on the job.
 *
 * The proposal's zones are folded into one group per service. Each group
 * can be turned into a link: what we want done in every area needing that
 * service, with the photos, and a box for the price. Copy the link, text
 * it to the sub, and the number comes back here.
 */
export function SubQuotesPanel({ jobId, groups, requests }: { jobId: string; groups: ServiceGroup[]; requests: SubQuoteRequestRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (groups.length === 0) return null;

  function create(serviceLabel: string) {
    setError(null);
    setBusy(serviceLabel);
    startTransition(async () => {
      const result = await createSubQuoteRequest({ jobId, serviceLabel });
      setBusy(null);
      if (!result.ok) return setError(result.message);
      router.refresh();
    });
  }

  function close(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await closeSubQuoteRequest(id);
      if (!result.ok) return setError(result.message);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        Get a sub&apos;s price
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        One link per service. It shows what we want done in each area with the photos, no zones and no client, and takes their price.
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {groups.map((group) => {
          const mine = requests.filter((r) => r.serviceLabel === group.serviceLabel);
          const photos = group.areas.reduce((n, a) => n + a.photoPaths.length, 0);
          return (
            <li key={group.serviceLabel} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{group.serviceLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.areas.length} area{group.areas.length === 1 ? "" : "s"} · {photos} photo{photos === 1 ? "" : "s"}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => create(group.serviceLabel)} className="min-h-9">
                  {busy === group.serviceLabel && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {mine.length === 0 ? "Make a link" : "Make another link"}
                </Button>
              </div>

              {mine.length > 0 && (
                <ul className="mt-2 flex flex-col gap-2">
                  {mine.map((r) => (
                    <li key={r.id} className={cn("rounded-md border px-2.5 py-2 text-xs", r.status === "quoted" ? "border-emerald-600/40 bg-emerald-50/60" : "border-border bg-background/60")}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn("rounded px-1.5 py-0.5 font-medium", r.status === "quoted" ? "bg-emerald-100 text-emerald-800" : r.status === "closed" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800")}>
                          {SUB_QUOTE_STATUS_LABEL[r.status]}
                        </span>
                        <span className="text-muted-foreground">made {dateShort(r.createdAt)}</span>
                        {r.status !== "closed" && <CopyButton text={r.link} label="Copy link" />}
                        {r.status !== "closed" && (
                          <button type="button" disabled={isPending} onClick={() => close(r.id)} className="text-muted-foreground underline underline-offset-2">
                            Close
                          </button>
                        )}
                      </div>
                      {r.quoteAmount != null && (
                        <p className="mt-1">
                          <span className="text-base font-semibold">{money(r.quoteAmount)}</span>
                          {r.contractorName && <span className="ml-1.5">from {r.contractorName}</span>}
                          {r.contractorPhone && <span className="ml-1.5 text-muted-foreground">{r.contractorPhone}</span>}
                          {r.contractorEmail && <span className="ml-1.5 text-muted-foreground">{r.contractorEmail}</span>}
                          {r.quotedAt && <span className="ml-1.5 text-muted-foreground">{dateShort(r.quotedAt)}</span>}
                        </p>
                      )}
                      {r.quoteNote && <p className="mt-0.5 text-muted-foreground">{r.quoteNote}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
