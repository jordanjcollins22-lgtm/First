"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProposalDraft, approveProposal } from "@/lib/actions/proposal-actions";
import type { ProposalWithJob } from "@/lib/data/all-proposals";
import { ViewCount } from "@/components/proposal/view-count";
import { TrimPanel } from "@/components/proposal/trim-panel";
import { priceMoveLabel, trimSummary } from "@/lib/proposal-trim";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ProposalRow({ item, showApprove }: { item: ProposalWithJob; showApprove: boolean }) {
  const { proposal, job, viewLabel, viewsWarm, edits } = item;
  const [total, setTotal] = useState(String(Math.round(proposal.total_cost ?? 0)));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [trimming, setTrimming] = useState(false);

  function saveTotal() {
    setError(null);
    startTransition(async () => {
      try {
        await updateProposalDraft(job.id, { totalCost: Number(total) || 0, scopeSnapshot: proposal.scope_snapshot });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save that.");
      }
    });
  }

  function approve() {
    setError(null);
    startTransition(async () => {
      try {
        await approveProposal(job.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't approve this proposal.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/60 bg-card/70 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{job.property.customer.name}</p>
          <p className="text-xs text-muted-foreground">{job.property.address}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{formatDate(proposal.generated_at)}</span>
      </div>

      {/* Whether they have actually read it. Sent and read are different
          facts, and the office only ever had the first one. */}
      <ViewCount label={viewLabel} warm={viewsWarm} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            type="number"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            disabled={!showApprove || isPending}
            className="h-9 w-28 text-sm"
          />
        </div>
        {showApprove && (
          <>
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={saveTotal}>
              {saved ? "Saved" : "Save price"}
            </Button>
            <Button type="button" size="sm" disabled={isPending} onClick={approve}>
              Approve &amp; send
            </Button>
          </>
        )}
        {/* Available after it has gone out too: a client ringing up to drop
            an area is the whole reason this exists. Not on an accepted one,
            where the price is something they already agreed to. */}
        {proposal.status !== "accepted" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => setTrimming((v) => !v)}
          >
            {trimming ? "Close" : "Remove items"}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" asChild>
          <a href={`/proposal/${proposal.token}?preview=1`} target="_blank" rel="noreferrer">
            Preview
          </a>
        </Button>
        <Button type="button" size="sm" variant="ghost" asChild>
          <Link href={`/jobs/${job.id}`}>Open job</Link>
        </Button>
      </div>

      {trimming && (
        <TrimPanel
          proposalId={proposal.id}
          zones={proposal.scope_snapshot ?? []}
          totalCents={Math.round((proposal.total_cost ?? 0) * 100)}
          onDone={() => setTrimming(false)}
        />
      )}

      {/* What has come off since it went out. Ours only: the client sees the
          shorter proposal, not the history of how it got shorter. */}
      {edits.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-white/60 bg-card/50 p-2.5">
          <p className="text-xs font-semibold text-muted-foreground">Removed since it went out</p>
          {edits.map((edit) => (
            <div key={edit.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {trimSummary({ removedZones: edit.removedZones, removedLines: edit.removedLines })}
              </span>
              {" — "}
              {priceMoveLabel(edit.previousTotalCents ?? 0, edit.newTotalCents ?? 0)}
              {edit.editedByName ? `, by ${edit.editedByName}` : ""} on {formatDate(edit.createdAt)}
              {edit.removedLines.length > 0 && (
                <ul className="mt-0.5 list-disc pl-4">
                  {edit.removedLines.map((line) => (
                    <li key={`${line.zoneName}:${line.line}`}>
                      <span className="italic">&ldquo;{line.line}&rdquo;</span> from {line.zoneName}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {proposal.client_response_note && (
        <p className="text-xs text-muted-foreground">
          Client note: <span className="italic">&ldquo;{proposal.client_response_note}&rdquo;</span>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ProposalListSection({
  items,
  showApprove,
  emptyLabel,
}: {
  items: ProposalWithJob[];
  showApprove: boolean;
  emptyLabel: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ProposalRow key={item.proposal.id} item={item} showApprove={showApprove} />
      ))}
    </div>
  );
}

export function ProposalsView({ proposals }: { proposals: ProposalWithJob[] }) {
  const needsApproval = proposals.filter((p) => p.proposal.status === "needs_approval");
  const sent = proposals.filter((p) => p.proposal.status === "sent");
  const declined = proposals.filter((p) => p.proposal.status === "declined");
  const accepted = proposals.filter((p) => p.proposal.status === "accepted");

  return (
    <Tabs defaultValue="needs_approval">
      <TabsList>
        <TabsTrigger value="needs_approval">Needs Approval ({needsApproval.length})</TabsTrigger>
        <TabsTrigger value="sent">Sent ({sent.length})</TabsTrigger>
        <TabsTrigger value="declined">Declined ({declined.length})</TabsTrigger>
        <TabsTrigger value="accepted">Accepted ({accepted.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="needs_approval">
        <ProposalListSection items={needsApproval} showApprove emptyLabel="Nothing waiting on you." />
      </TabsContent>
      <TabsContent value="sent">
        <ProposalListSection items={sent} showApprove={false} emptyLabel="Nothing sent yet." />
      </TabsContent>
      <TabsContent value="declined">
        <ProposalListSection items={declined} showApprove={false} emptyLabel="No declined proposals." />
      </TabsContent>
      <TabsContent value="accepted">
        <ProposalListSection items={accepted} showApprove={false} emptyLabel="No accepted proposals yet." />
      </TabsContent>
    </Tabs>
  );
}
