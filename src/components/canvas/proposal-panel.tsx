"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateProposal } from "@/lib/actions/proposal-actions";
import type { JobProposal } from "@/types/domain";

export interface InternalZoneBreakdown {
  zoneName: string;
  serviceLabel: string;
  notes: string;
  checklistAnswers: { label: string; value: string }[];
  materialLineItems: { material: string; quantityLabel: string; cost: number | null }[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-700",
  accepted: "border-primary/40 bg-primary/10 text-primary",
  declined: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** Internal-only breakdown attached to the job — same underlying site map as
 * the client proposal, but with cost detail and evaluator notes the client
 * never sees. Never rendered on the public /proposal page. */
export function ProposalPanel({
  jobId,
  proposal,
  baseUrl,
  serviceCost,
  materialsCost,
  zones,
}: {
  jobId: string;
  proposal: JobProposal | null;
  baseUrl: string;
  serviceCost: number;
  materialsCost: number;
  zones: InternalZoneBreakdown[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const link = proposal ? `${baseUrl}/proposal/${proposal.token}` : null;

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      try {
        await generateProposal(jobId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't generate the proposal.");
      }
    });
  }

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-semibold">Client Proposal</p>
          {proposal && (
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLE[proposal.status])}>
              {STATUS_LABEL[proposal.status]}
            </span>
          )}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleGenerate}>
          {proposal ? "Regenerate" : "Generate Proposal"}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {proposal && (
        <>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-2.5">
            <p className="min-w-0 truncate text-xs text-muted-foreground">{link}</p>
            <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          {proposal.client_response_note && (
            <p className="text-xs text-muted-foreground">
              Client note: <span className="italic">&ldquo;{proposal.client_response_note}&rdquo;</span>
            </p>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <div>
              <p className="text-xs text-muted-foreground">Client sees one total</p>
              <p className="text-lg font-semibold">${Math.round(serviceCost + materialsCost).toLocaleString()}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowBreakdown((v) => !v)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Internal breakdown
              {showBreakdown ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          {showBreakdown && (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Internal only — the client never sees this
              </p>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Service cost</span>
                <span>${Math.round(serviceCost).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Material cost</span>
                <span>${Math.round(materialsCost).toLocaleString()}</span>
              </div>
              {zones.map((zone, i) => (
                <div key={i} className="rounded-md border border-border/60 p-2.5 text-xs">
                  <p className="font-medium">
                    {zone.zoneName} <span className="text-muted-foreground">· {zone.serviceLabel}</span>
                  </p>
                  {zone.checklistAnswers.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                      {zone.checklistAnswers.map((a, j) => (
                        <li key={j}>
                          {a.label}: {a.value}
                        </li>
                      ))}
                    </ul>
                  )}
                  {zone.notes && <p className="mt-1 text-muted-foreground">Evaluator notes: {zone.notes}</p>}
                  {zone.materialLineItems.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                      {zone.materialLineItems.map((m, j) => (
                        <li key={j}>
                          {m.material}: {m.quantityLabel}
                          {m.cost != null && ` · $${m.cost.toFixed(2)}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
