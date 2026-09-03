"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Eye, Loader2, Pencil, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DiscountSelect } from "@/components/canvas/discount-select";
import { ViewCount } from "@/components/proposal/view-count";
import { cn } from "@/lib/utils";
import { generateProposal, updateProposalDraft, approveProposal } from "@/lib/actions/proposal-actions";
import { suggestZoneScope } from "@/lib/actions/scope-suggestion-actions";
import { effectiveMultiplier, type Markup } from "@/lib/job-costing";
import type { Discount, JobProposal, ProposalZoneSnapshot } from "@/types/domain";

export interface InternalZoneBreakdown {
  zoneName: string;
  serviceLabel: string;
  notes: string;
  checklistAnswers: { label: string; value: string }[];
  materialLineItems: { material: string; quantityLabel: string; cost: number | null }[];
  /** Crew-hours: a three-person crew for an hour is three. */
  crewHours: number;
  materialsCents: number;
  labourCents: number;
  /** Materials and labour, before markup. */
  directCostCents: number;
  priceCents: number;
  /** No timing on the service, so nothing was charged for the work itself. */
  hasMissingTiming: boolean;
  /** A material here has no unit cost, so the figure is a floor. */
  hasUnknownMaterialCost: boolean;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_LABEL: Record<string, string> = {
  needs_approval: "Needs approval",
  sent: "Sent — awaiting response",
  accepted: "Accepted",
  declined: "Declined",
};

const STATUS_STYLE: Record<string, string> = {
  needs_approval: "border-amber-400/40 bg-amber-400/10 text-amber-700",
  sent: "border-blue-400/40 bg-blue-400/10 text-blue-700",
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
  labourCost,
  materialsCost,
  markup,
  zones,
  discounts,
  viewLabel = null,
  viewsWarm = false,
}: {
  jobId: string;
  proposal: JobProposal | null;
  baseUrl: string;
  labourCost: number;
  materialsCost: number;
  /** How direct cost becomes the quoted price, for the line that says so. */
  markup: Markup;
  zones: InternalZoneBreakdown[];
  discounts: Discount[];
  /** How often the client has opened it. Null when there is nothing to say
   * yet. Internal only — this never reaches the public page. */
  viewLabel?: string | null;
  viewsWarm?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTotal, setDraftTotal] = useState("");
  const [draftZones, setDraftZones] = useState<ProposalZoneSnapshot[]>([]);
  const [draftDiscountId, setDraftDiscountId] = useState<string | null>(null);
  const [localDiscounts, setLocalDiscounts] = useState<Discount[]>(discounts);
  /** What the last rebuild changed. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Set when rebuilding would clear a client's acceptance. */
  const [confirm, setConfirm] = useState<string | null>(null);
  /** Which zone is having a scope line written for it, by index. */
  const [suggesting, setSuggesting] = useState<number | null>(null);
  /** Why a suggestion did not arrive, against the zone that asked for it. */
  const [suggestError, setSuggestError] = useState<{ index: number; message: string } | null>(null);

  /**
   * Draft a zone's scope line from what the evaluator recorded.
   *
   * Writes straight into the box rather than offering it alongside: this is a
   * draft inside a draft, thrown away by Cancel and only real once somebody
   * presses Save changes. Asking them to approve the suggestion and then
   * approve the proposal is one approval too many.
   */
  function handleSuggest(index: number) {
    const zone = draftZones[index];
    if (!zone) return;
    // Matched by name rather than by position: the breakdown comes from the
    // job's live zones and the draft from the proposal's snapshot, and a
    // proposal taken before a zone was added has the two out of step.
    const breakdown = zones.find((z) => z.zoneName === zone.zoneName);

    setSuggestError(null);
    setSuggesting(index);
    startTransition(async () => {
      try {
        const result = await suggestZoneScope({
          zoneName: zone.zoneName,
          serviceLabel: zone.serviceLabel,
          notes: breakdown?.notes ?? "",
          checklistAnswers: breakdown?.checklistAnswers ?? [],
          // Names only. The quantities sit right here on the breakdown, and
          // deliberately do not travel: a scope line must not quote one.
          materials: [...new Set((breakdown?.materialLineItems ?? []).map((m) => m.material))],
        });
        if (result.ok) {
          setDraftZones((prev) =>
            prev.map((z, j) => (j === index ? { ...z, scopeText: result.text } : z))
          );
        } else {
          setSuggestError({ index, message: result.message });
        }
      } finally {
        setSuggesting(null);
      }
    });
  }

  const link = proposal ? `${baseUrl}/proposal/${proposal.token}` : null;
  /**
   * Preview opens on whatever host you are using right now, not on the
   * canonical domain the client's link points at.
   *
   * Those are different addresses on a preview deployment, and often
   * different databases, which is how tapping Preview landed on "this
   * proposal link isn't valid" for a proposal that plainly exists. The
   * canonical domain is right for the link a client receives and wrong for
   * a page only we open.
   */
  const previewLink = proposal ? `/proposal/${proposal.token}?preview=1` : null;

  /**
   * Take a fresh snapshot of the site map.
   *
   * Says what it did. A rebuild that quietly changes nothing is
   * indistinguishable from a broken button, and that is exactly how a
   * proposal ends up still quoting a service nobody is doing.
   */
  function handleGenerate(force = false) {
    setError(null);
    setNotice(null);
    setConfirm(null);
    setEditing(false);
    startTransition(async () => {
      try {
        const outcome = await generateProposal(jobId, { force });
        if (outcome.ok) {
          setNotice(
            outcome.unchanged
              ? "Rebuilt — the site map already matched this proposal."
              : `Rebuilt: ${outcome.changes.join(" · ")}`
          );
        } else if (outcome.reason === "needs_confirmation") {
          setConfirm(outcome.confirm ?? "Replace the accepted proposal?");
        } else {
          setError(
            outcome.reason === "no_services"
              ? "No zone on the site map has a service on it yet."
              : "There's no site map on this job to build from."
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't generate the proposal.");
      }
    });
  }

  function startEditing() {
    if (!proposal) return;
    setDraftTotal(String(Math.round(proposal.total_cost ?? 0)));
    setDraftZones(proposal.scope_snapshot.map((z) => ({ ...z })));
    setDraftDiscountId(proposal.discount_id);
    setError(null);
    setEditing(true);
  }

  function handleSaveDraft() {
    setError(null);
    startTransition(async () => {
      try {
        await updateProposalDraft(jobId, {
          totalCost: Number(draftTotal) || 0,
          scopeSnapshot: draftZones,
          discountId: draftDiscountId,
        });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save those changes.");
      }
    });
  }

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveProposal(jobId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't approve the proposal.");
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
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => handleGenerate()}>
          {proposal ? "Regenerate from site map" : "Generate now"}
        </Button>
      </div>

      {confirm && (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{confirm}</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={() => handleGenerate(true)}>
              Rebuild it anyway
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Leave it
            </Button>
          </div>
        </div>
      )}

      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

      {!proposal && (
        <p className="text-xs text-muted-foreground">
          A proposal will be generated automatically once the evaluation is submitted.
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {proposal && (
        <>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-2.5">
            <p className="min-w-0 truncate text-xs text-muted-foreground">{link}</p>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={previewLink ?? "#"} target="_blank" rel="noreferrer">
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </a>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </div>
          {viewLabel && (
            <div className="flex items-center justify-between gap-2">
              <ViewCount label={viewLabel} warm={viewsWarm} />
              {viewsWarm && (
                <span className="text-[11px] text-amber-700">Worth a call</span>
              )}
            </div>
          )}
          {proposal.client_response_note && (
            <p className="text-xs text-muted-foreground">
              Client note: <span className="italic">&ldquo;{proposal.client_response_note}&rdquo;</span>
            </p>
          )}

          {editing ? (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Subtotal</label>
                <Input
                  type="number"
                  value={draftTotal}
                  onChange={(e) => setDraftTotal(e.target.value)}
                  className="h-9 w-32 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Discount</label>
                <DiscountSelect
                  discounts={localDiscounts}
                  selectedId={draftDiscountId}
                  onChange={setDraftDiscountId}
                  onCreated={(d) => setLocalDiscounts((prev) => [...prev, d])}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Client sees: $
                {(() => {
                  const selected = localDiscounts.find((d) => d.id === draftDiscountId);
                  const subtotal = Number(draftTotal) || 0;
                  const discountAmount = !selected ? 0 : selected.kind === "percentage" ? (subtotal * selected.value) / 100 : selected.value;
                  return Math.max(0, Math.round(subtotal - discountAmount)).toLocaleString();
                })()}
              </p>
              {draftZones.map((zone, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {zone.zoneName} — {zone.serviceLabel}
                  </label>
                  <Textarea
                    value={zone.scopeText}
                    onChange={(e) =>
                      setDraftZones((prev) => prev.map((z, j) => (j === i ? { ...z, scopeText: e.target.value } : z)))
                    }
                    rows={2}
                    className="text-sm"
                  />
                  {/* Under the box it fills, not in a toolbar at the top: the
                      evaluator's notes for this zone are what it writes from,
                      and this is the only place that is obvious. */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSuggest(i)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50 disabled:no-underline"
                    >
                      {suggesting === i ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          Writing from the notes...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" aria-hidden />
                          Suggest from evaluator notes
                        </>
                      )}
                    </button>
                    {suggestError?.index === i && (
                      <span className="text-xs text-muted-foreground">{suggestError.message}</span>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={handleSaveDraft} disabled={isPending}>
                  Save changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between border-t border-border pt-3">
              <div>
                {proposal.discount_amount > 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Subtotal ${Math.round(proposal.total_cost ?? 0).toLocaleString()} — discount $
                      {Math.round(proposal.discount_amount).toLocaleString()}
                      {proposal.discount_reason && ` (${proposal.discount_reason})`}
                    </p>
                    <p className="text-lg font-semibold">
                      ${Math.max(0, Math.round((proposal.total_cost ?? 0) - proposal.discount_amount)).toLocaleString()}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">Client sees one total</p>
                    <p className="text-lg font-semibold">${Math.round(proposal.total_cost ?? 0).toLocaleString()}</p>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={startEditing}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setShowBreakdown((v) => !v)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Internal breakdown
                  {showBreakdown ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          )}

          {proposal.status === "needs_approval" && !editing && (
            <Button type="button" className="self-start" disabled={isPending} onClick={handleApprove}>
              Approve &amp; send to client
            </Button>
          )}

          {showBreakdown && !editing && (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Internal only — the client never sees this
              </p>
              {/* What it costs us, then what turns that into the price. The
                  account manager is approving the last line, and the only way
                  to judge it is to see the three above it. */}
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Labour</span>
                <span>${Math.round(labourCost).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Materials</span>
                <span>${Math.round(materialsCost).toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-border/60 pt-2 text-xs font-medium">
                <span>Cost to us</span>
                <span>${Math.round(labourCost + materialsCost).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  &times;{markup.multiplier}
                  {markup.overheadPercent > 0 && ` plus ${markup.overheadPercent}% overhead`}
                </span>
                <span className="text-muted-foreground">
                  &times;{effectiveMultiplier(markup).toFixed(2)} overall
                </span>
              </div>

              {zones.some((zone) => zone.hasMissingTiming) && (
                /* Silence here would quote a job at the cost of its mulch.
                   Named rather than counted, because the fix is to go and put
                   a time on that service. */
                <p className="rounded-md bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-700">
                  No timing set for{" "}
                  {[...new Set(zones.filter((z) => z.hasMissingTiming).map((z) => z.serviceLabel))].join(", ")}
                  , so no labour is being charged for it.
                </p>
              )}
              {zones.some((zone) => zone.hasUnknownMaterialCost) && (
                <p className="rounded-md bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-700">
                  A material here has no unit cost, so this is a floor rather than the price.
                </p>
              )}
              {zones.map((zone, i) => (
                <div key={i} className="rounded-md border border-border/60 p-2.5 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {zone.zoneName} <span className="text-muted-foreground">· {zone.serviceLabel}</span>
                    </p>
                    <span className="shrink-0 font-semibold">{money(zone.priceCents)}</span>
                  </div>
                  {/* The same three lines as the job, for the one area. A
                      client who asks to drop a zone is asking about this. */}
                  <p className="text-muted-foreground">
                    {zone.crewHours > 0
                      ? `${zone.crewHours.toFixed(1)} crew hr · ${money(zone.labourCents)} labour`
                      : "No labour"}
                    {" · "}
                    {money(zone.materialsCents)} materials
                    {" · "}
                    {money(zone.directCostCents)} cost
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
