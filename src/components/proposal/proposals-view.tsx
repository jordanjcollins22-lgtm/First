"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProposalDraft, approveProposal } from "@/lib/actions/proposal-actions";
import type { ProposalWithJob } from "@/lib/data/all-proposals";
import { ViewCount } from "@/components/proposal/view-count";
import { TrimPanel } from "@/components/proposal/trim-panel";
import { editHeadline, priceMoveLabel } from "@/lib/proposal-trim";
import { responseLabel } from "@/lib/proposal-accepted";
import { owedFirst, paymentLabel, paymentState, type PaymentFacts } from "@/lib/proposal-payment";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** What the payment state is worked out from, in cents. */
function factsFor(item: ProposalWithJob): PaymentFacts {
  return {
    totalCents: item.proposal.total_cost == null ? null : Math.round(item.proposal.total_cost * 100),
    collectedCents: item.collectedCents,
    settledAt: item.proposal.paid_at,
  };
}

function ProposalRow({
  item,
  showApprove,
  timeZone,
}: {
  item: ProposalWithJob;
  showApprove: boolean;
  timeZone: string | null;
}) {
  const { proposal, job, viewLabel, viewsWarm, readLabel, edits } = item;
  // When they answered, not just that they did. Same wording as the job page.
  const responded = responseLabel(proposal.status, proposal.responded_at, timeZone);
  const facts = factsFor(item);
  const state = paymentState(facts);
  const money = proposal.status === "accepted" ? paymentLabel(facts) : null;
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

      {/* And what they were stuck on. "Opened 4 times" says they are
          interested; "most time on the price" says what to open the call
          with, and those are different pieces of information. Silent when
          there is too little reading to draw anything from. */}
      {readLabel !== "Nothing read yet" && (
        <p className="text-xs text-muted-foreground">{readLabel}</p>
      )}

      {/* And when they answered. The timestamp was always recorded and never
          shown, so "when did they sign?" was answered from memory. */}
      {responded && (
        <p className="text-xs font-medium text-muted-foreground">{responded}</p>
      )}

      {/* And whether the money turned up. Nothing is said on a proposal with
          nothing in, because "$0 in" on every unpaid row is noise. */}
      {money && (
        <p
          className={cn(
            "text-xs font-semibold",
            state === "paid" ? "text-primary" : "text-amber-700 dark:text-amber-500"
          )}
        >
          {money}
        </p>
      )}

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
          <p className="text-xs font-semibold text-muted-foreground">Changes since it went out</p>
          {edits.map((edit) => (
            <div key={edit.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {editHeadline({
                  removedZones: edit.removedZones,
                  removedLines: edit.removedLines,
                  requestedVia: edit.requestedVia,
                  previousTotalCents: edit.previousTotalCents,
                  newTotalCents: edit.newTotalCents,
                })}
              </span>
              {" — "}
              {priceMoveLabel(edit.previousTotalCents ?? 0, edit.newTotalCents ?? 0)}
              {edit.editedByName ? `, by ${edit.editedByName}` : ""} on {formatDate(edit.createdAt)}
              {/* What they said, which is the part somebody wants in six
                  months rather than the arithmetic. */}
              {edit.note && (
                <p className="mt-0.5 italic">&ldquo;{edit.note}&rdquo;</p>
              )}
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
  timeZone,
}: {
  items: ProposalWithJob[];
  showApprove: boolean;
  emptyLabel: string;
  timeZone: string | null;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ProposalRow key={item.proposal.id} item={item} showApprove={showApprove} timeZone={timeZone} />
      ))}
    </div>
  );
}

export function ProposalsView({
  proposals,
  timeZone = null,
}: {
  proposals: ProposalWithJob[];
  /** The clock the office keeps, so a signature is not dated by the server. */
  timeZone?: string | null;
}) {
  const needsApproval = proposals.filter((p) => p.proposal.status === "needs_approval");
  const sent = proposals.filter((p) => p.proposal.status === "sent");
  const declined = proposals.filter((p) => p.proposal.status === "declined");

  // Accepted and paid are different facts, and the board only had the first.
  // A proposal signed in September sat beside one signed and settled the same
  // afternoon, and nothing told them apart — so chasing money meant opening
  // jobs one at a time. Paid comes out of Accepted rather than sitting
  // alongside it: a job cannot be in both, and what is left under Accepted is
  // exactly the list of people who owe us money.
  const signed = proposals.filter((p) => p.proposal.status === "accepted");
  const paid = signed.filter((p) => paymentState(factsFor(p)) === "paid");
  const awaitingMoney = signed
    .filter((p) => paymentState(factsFor(p)) !== "paid")
    .sort((a, b) => owedFirst(factsFor(a), factsFor(b)));

  return (
    <Tabs defaultValue="needs_approval">
      <TabsList>
        <TabsTrigger value="needs_approval">Needs Approval ({needsApproval.length})</TabsTrigger>
        <TabsTrigger value="sent">Sent ({sent.length})</TabsTrigger>
        <TabsTrigger value="declined">Declined ({declined.length})</TabsTrigger>
        <TabsTrigger value="accepted">Accepted ({awaitingMoney.length})</TabsTrigger>
        <TabsTrigger value="paid">Paid ({paid.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="needs_approval">
        <ProposalListSection items={needsApproval} showApprove emptyLabel="Nothing waiting on you." timeZone={timeZone} />
      </TabsContent>
      <TabsContent value="sent">
        <ProposalListSection items={sent} showApprove={false} emptyLabel="Nothing sent yet." timeZone={timeZone} />
      </TabsContent>
      <TabsContent value="declined">
        <ProposalListSection items={declined} showApprove={false} emptyLabel="No declined proposals." timeZone={timeZone} />
      </TabsContent>
      <TabsContent value="accepted">
        {/* Sold and still owing, biggest debt first, because that is the call
            worth making next. */}
        <ProposalListSection
          items={awaitingMoney}
          showApprove={false}
          emptyLabel="Nothing sold is waiting on money."
          timeZone={timeZone}
        />
      </TabsContent>
      <TabsContent value="paid">
        <ProposalListSection
          items={paid}
          showApprove={false}
          emptyLabel="Nothing has been paid in full yet."
          timeZone={timeZone}
        />
      </TabsContent>
    </Tabs>
  );
}
