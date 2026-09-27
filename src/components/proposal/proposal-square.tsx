"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Eye, Loader2, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { approveProposal, sendProposalToClient } from "@/lib/actions/proposal-actions";
import type { JobEstimate } from "@/lib/job-estimate";
import type { JobProposal } from "@/types/domain";

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function hours(h: number): string {
  return `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
}

function minutes(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`;
}

/**
 * The proposal in one square: what the site map came to, and a yes or no.
 *
 * Each area's hours and crew, the days it runs, the drive from the shop and
 * back every day and to the supplier, the materials and what they cost, what
 * it all costs us, and the price. Yes makes it live; No opens the editor
 * underneath to change it. After a yes, Preview shows what the client will
 * see and Send to client emails it to them, then and there.
 */
export function ProposalSquare({
  jobId,
  proposal,
  sendTo,
  children,
}: {
  jobId: string;
  proposal: JobProposal | null;
  /** The client's email, or null when there is none on file. */
  sendTo: string | null;
  /** The full editor: price, wording, discount, how long it stands. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"yes" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDetailsElement>(null);

  const estimate = (proposal?.estimate ?? null) as JobEstimate | null;
  const clientPays = proposal ? Math.max(0, Number(proposal.total_cost ?? 0) - Number(proposal.discount_amount ?? 0)) : 0;

  function openEditor() {
    setEditing(true);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function yes() {
    setError(null);
    setNote(null);
    setBusy("yes");
    start(async () => {
      try {
        await approveProposal(jobId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't approve it.");
      } finally {
        setBusy(null);
      }
    });
  }

  function send() {
    setError(null);
    setNote(null);
    setBusy("send");
    start(async () => {
      const result = await sendProposalToClient(jobId);
      setBusy(null);
      if (!result.ok) return setError(result.error);
      setNote(`Sent to ${result.to}.`);
      router.refresh();
    });
  }

  const previewHref = proposal ? `/proposal/${proposal.token}?preview=1` : null;
  const status = proposal?.status ?? null;
  const approved = status === "sent" && Boolean(proposal?.approved_at);

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proposal</p>
            <p className="text-3xl font-bold tabular-nums">{proposal ? `$${Math.round(clientPays).toLocaleString()}` : "Not built yet"}</p>
            {proposal && Number(proposal.discount_amount ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                ${Math.round(Number(proposal.total_cost ?? 0)).toLocaleString()} less {proposal.discount_reason ?? "a discount"}
              </p>
            )}
          </div>
          {status && <StatusChip status={status} sentAt={proposal?.sent_at ?? null} approved={approved} />}
        </div>

        {!proposal && <p className="mt-2 text-sm text-muted-foreground">Built from the site map when the evaluation is submitted.</p>}

        {proposal && !estimate && (
          <p className="mt-2 text-sm text-muted-foreground">
            Built before estimates existed. Rebuild it from the site map (in Change it, below) to see the hours, travel and materials.
          </p>
        )}

        {estimate && <EstimateBody estimate={estimate} />}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {note && <p className="mt-3 text-sm font-medium text-primary">{note}</p>}

        {/* The decision. */}
        {proposal && status === "needs_approval" && (
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={openEditor} className="h-11">
              <X className="mr-1 h-4 w-4" /> No
            </Button>
            <Button type="button" disabled={pending} onClick={yes} className="h-11">
              {busy === "yes" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              Yes, {`$${Math.round(clientPays).toLocaleString()}`}
            </Button>
          </div>
        )}
        {proposal && approved && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" asChild className="h-11">
                <a href={previewHref ?? "#"} target="_blank" rel="noreferrer">
                  <Eye className="mr-1 h-4 w-4" /> Preview
                </a>
              </Button>
              <Button type="button" disabled={pending || !sendTo} onClick={send} className="h-11">
                {busy === "send" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                {proposal.sent_at ? "Send again" : "Send to client"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {sendTo
                ? proposal.sent_at
                  ? `Sent ${new Date(proposal.sent_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. Sending again emails ${sendTo} the same link.`
                  : `Emails ${sendTo} the link, the price and how long it stands, as soon as you press it.`
                : "The client has no email on file. Copy the link from Change it, below, and text it to them."}
            </p>
          </div>
        )}
      </section>

      {/* No, or anything else to change: the full editor. */}
      <details
        ref={editorRef}
        open={editing}
        onToggle={(e) => setEditing((e.target as HTMLDetailsElement).open)}
        className="rounded-xl border border-border bg-card/60 px-4 py-3"
      >
        <summary className="cursor-pointer text-sm font-semibold">Change it: price, wording, discount, how long it stands</summary>
        <div className="mt-3">{children}</div>
      </details>
    </div>
  );
}

function StatusChip({ status, sentAt, approved }: { status: string; sentAt: string | null; approved: boolean }) {
  const label =
    status === "needs_approval"
      ? "Waiting on your yes"
      : approved && !sentAt
        ? "Approved, not sent"
        : status === "sent"
          ? "Sent to client"
          : status === "accepted"
            ? "Accepted"
            : status === "paid"
              ? "Paid"
              : status === "declined"
                ? "Declined"
                : status;
  return <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold">{label}</span>;
}

/** Everything the number is made of, dense but readable. */
function EstimateBody({ estimate: e }: { estimate: JobEstimate }) {
  const materialsKnown = e.materials.filter((m) => m.costCents != null);
  return (
    <div className="mt-3 flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Chip>{e.crew === 1 ? "1 person" : `${e.crew} people`}</Chip>
        <Chip>{hours(e.onSiteHours)} on site</Chip>
        <Chip>{e.days === 1 ? "1 day" : `${e.days} days`}</Chip>
        <Chip>{hours(e.travel.crewHours)} crew travel</Chip>
      </div>

      <Block title="Each area">
        <ul className="divide-y divide-border/60">
          {e.zones.map((z) => (
            <li key={z.name} className="flex items-baseline justify-between gap-3 py-1">
              <span className="min-w-0">
                <span className="font-medium">{z.name}</span>
                <span className="text-muted-foreground"> · {z.service}{z.sizeLabel ? ` · ${z.sizeLabel}` : ""}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {z.missingTiming ? "no timing" : `${hours(z.hours)} × ${z.crewSize}`}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Travel">
        <ul className="flex flex-col gap-0.5">
          <li className="flex justify-between gap-3">
            <span>Morning, {e.travel.from ?? "the shop"} to the job</span>
            <span className="tabular-nums text-muted-foreground">
              {minutes(e.travel.toSiteMinutes)}
              {e.days > 1 ? ` × ${e.days} days` : ""}
            </span>
          </li>
          <li className="flex justify-between gap-3">
            <span>End of day, back to the shop</span>
            <span className="tabular-nums text-muted-foreground">
              {minutes(e.travel.fromSiteMinutes)}
              {e.days > 1 ? ` × ${e.days} days` : ""}
            </span>
          </li>
          {e.travel.pickupMinutes > 0 && (
            <li className="flex justify-between gap-3">
              <span>Material pickup{e.travel.pickupFrom ? `, ${e.travel.pickupFrom.replace(/^material pickup:\s*/i, "")}` : ""}</span>
              <span className="tabular-nums text-muted-foreground">+{minutes(e.travel.pickupMinutes)}, once</span>
            </li>
          )}
        </ul>
        {e.travel.notes.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{e.travel.notes.join(" ")}</p>}
      </Block>

      {e.materials.length > 0 && (
        <Block title="Materials">
          <ul className="flex flex-col gap-0.5">
            {e.materials.map((m, i) => (
              <li key={`${m.zone}-${m.name}-${i}`} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {m.name} <span className="text-muted-foreground">· {m.quantityLabel}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{m.costCents == null ? "no cost" : money(m.costCents)}</span>
              </li>
            ))}
          </ul>
          {materialsKnown.length > 1 && <p className="mt-1 text-right text-xs font-medium tabular-nums">{money(e.costs.materialsCents)} in all</p>}
        </Block>
      )}

      <Block title="Cost to us, and the price">
        <ul className="flex flex-col gap-0.5 tabular-nums">
          <Row label={`Labour on site (${hours(e.onSiteHours * e.crew)} crew)`} value={money(e.costs.onSiteLabourCents)} />
          <Row label={`Travel (${hours(e.travel.crewHours)} crew)`} value={money(e.costs.travelLabourCents)} />
          <Row label="Materials" value={money(e.costs.materialsCents)} />
          <Row label="Cost to us" value={money(e.costs.directCents)} strong />
          <Row label="The work, marked up" value={money(e.workPriceCents)} />
          <Row label="Travel, marked up" value={money(e.travelPriceCents)} />
          <Row label="Price" value={money(e.priceCents)} strong />
        </ul>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Crew rate {money(e.crewCostPerHourCents)} an hour. Travel is shared across the areas, so they add up to the price.
        </p>
      </Block>

      {e.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-amber-300/70 bg-amber-50/70 p-2.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
          {e.warnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{children}</span>;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <li className={`flex justify-between gap-3 ${strong ? "border-t border-border pt-0.5 font-semibold" : "text-muted-foreground"}`}>
      <span className={strong ? "text-foreground" : ""}>{label}</span>
      <span className={strong ? "text-foreground" : ""}>{value}</span>
    </li>
  );
}
