"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Copy, Loader2, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptPrice, savePriceDraft, setPrice } from "@/lib/actions/price-approval-actions";
import { sendProposalToClient } from "@/lib/actions/proposal-actions";
import { EmailHeading, ProposalEmailPreview } from "@/components/proposal/email-preview";
import { proposalReadyEmail } from "@/lib/proposal-ready-email";
import { DEFAULT_VALID_DAYS } from "@/lib/proposal-validity";
import { GROSS_PROFIT_TARGET, margin, priceForTarget, readPrice, type JobFee } from "@/lib/price-approval";
import type { PriceApproval } from "@/lib/data/price-approvals";
import { PriceSiteMap } from "@/components/proposal/price-site-map";
import { ScopeReviewPanel } from "@/components/canvas/scope-review-panel";
import { ForwardBreakdown, priceLines, unpricedAreas } from "@/components/proposal/forward-breakdown";
import type { PriceLine } from "@/lib/forward-pricing";
import { priceFromSuppliers } from "@/lib/forward-materials";
import { cn } from "@/lib/utils";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
// To the cent, for a visit's share, so the lines of it add up.
const cents = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hours = (h: number) => (h < 10 ? h.toFixed(1) : Math.round(h).toString());

/**
 * Walkthroughs waiting on the account manager, on their My Day: each one's
 * price with everything behind it, then Accept price or Decline price, then
 * Send to client.
 */
export function PriceApprovals({ items, preview = false }: { items: PriceApproval[]; preview?: boolean }) {
  const waiting = items.filter((i) => i.stage === "price").length;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">To price</h2>
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? "Nothing waiting. Walkthroughs land here when they are submitted."
            : waiting > 0
              ? `${waiting} walkthrough${waiting === 1 ? "" : "s"} submitted and waiting on a price.`
              : "Priced, and waiting to be sent."}
        </p>
      </div>
      {items.map((item) => (
        <PriceCard key={item.jobId} item={item} preview={preview} />
      ))}
    </section>
  );
}

export function PriceCard({
  item,
  preview = false,
  startAt,
}: {
  item: PriceApproval;
  preview?: boolean;
  /** For the preview's pages: open on a later step. */
  startAt?: "decline" | "send" | "sent";
}) {
  const [stage, setStage] = useState<"price" | "decline" | "send" | "sent">(startAt ?? item.stage);
  // Priced the forward way: every area's services, which the price follows.
  // Still to price: bulk materials priced from the closest supplier straight away, with no clicks.
  const [lines, setLines] = useState<PriceLine[][] | null>(() => {
    if (!item.forward) return null;
    const start = item.forward.map((a) => a.lines);
    return item.stage === "price" ? priceFromSuppliers(start, item.pricing.services, item.suppliers ?? [], item.site ?? null).lines : start;
  });
  const forwardCents = lines ? priceLines(item, lines).rCents : null;
  // Wording still to approve, approved here on the card; Accept waits for it.
  const needsWording = item.wordingToApprove.length > 0;
  const [wordingDone, setWordingDone] = useState(!needsWording);
  // Saved to the proposal as it is worked on, not approved, so the job page
  // and the proposal show this same price whether or not the wording is done.
  const [draft, setDraft] = useState<"saving" | "saved" | string | null>(null);
  useEffect(() => {
    if (preview || !lines || stage !== "price") return;
    const timer = setTimeout(() => {
      setDraft("saving");
      savePriceDraft(item.jobId, lines)
        .then((result) => setDraft(result.ok ? "saved" : result.error))
        .catch(() => setDraft("Couldn't save the price to the proposal."));
    }, 700);
    return () => clearTimeout(timer);
  }, [lines, stage, preview, item.jobId]);
  const unpriced = lines ? unpricedAreas(item, lines) : [];
  const [fixedTotal, setTotal] = useState(item.totalCents);
  // While it is being priced the forward way, the price is the services'.
  const total = forwardCents != null && (stage === "price" || stage === "decline") ? forwardCents : fixedTotal;
  const [typed, setTyped] = useState("");
  const [sendTo, setSendTo] = useState<string | null>(item.email);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // What the site map works out at: travel, whole hours and the floor in.
  const worked = item.costs.workedCents;

  function accept() {
    setError(null);
    if (preview) {
      if (forwardCents != null) setTotal(forwardCents);
      return setStage("send");
    }
    start(async () => {
      const result = lines ? await acceptPrice(item.jobId, lines) : await acceptPrice(item.jobId);
      if (!result.ok) return setError(result.error);
      if (forwardCents != null) setTotal(forwardCents);
      setSendTo(result.sendTo);
      setStage("send");
    });
  }

  // The client's own link, for texting when there is no email on file.
  const clientLink = item.proposalHref ? item.proposalHref.replace(/[?&]preview=1/, "") : null;
  const [copied, setCopied] = useState(false);
  async function copyLink() {
    if (!clientLink) return;
    try {
      await navigator.clipboard.writeText(new URL(clientLink, window.location.origin).toString());
      setCopied(true);
    } catch {
      setError("Couldn't copy the link.");
    }
  }

  function send() {
    setError(null);
    if (preview) return setStage("sent");
    start(async () => {
      const result = await sendProposalToClient(item.jobId);
      if (!result.ok) return setError(result.error);
      setSendTo(result.to);
      setStage("sent");
    });
  }

  function submitPrice(given?: number) {
    setError(null);
    const price = given ?? readPrice(typed);
    if (price == null) return setError("Type the price in dollars, like 2450.");
    if (preview) {
      setTotal(Math.round(price * 100));
      return setStage("send");
    }
    start(async () => {
      const result = await setPrice(item.jobId, price);
      if (!result.ok) return setError(result.error);
      setTotal(Math.round(price * 100));
      setSendTo(result.sendTo);
      setStage("send");
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{item.client}</p>
          <p className="text-sm text-muted-foreground">{item.address}</p>
          <p className="text-xs text-muted-foreground">
            Walkthrough by {item.evaluator ?? "the evaluator"}
            {item.submittedAt && `, ${new Date(item.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage === "price" || stage === "decline" ? "Price" : "Priced at"}</p>
          <p className="text-3xl font-bold tabular-nums">{dollars(total)}</p>
        </div>
      </div>

      {(stage === "price" || stage === "decline") && lines && <ForwardBreakdown item={item} lines={lines} onChange={setLines} locked={stage === "decline" || pending} />}
      {stage === "price" && lines && draft && (
        <p className={cn("text-xs", draft === "saved" || draft === "saving" ? "text-muted-foreground" : "text-destructive")}>
          {draft === "saving" ? "Saving this price to the proposal…" : draft === "saved" ? "This price is on the proposal and the job page. Not approved yet." : draft}
        </p>
      )}

      {(stage === "price" || stage === "decline") && !lines && (
        <>
          <Breakdown item={item} total={total} pending={pending} onUsePrice={(cents) => submitPrice(cents / 100)} />
          {total !== worked && worked > 0 && (
            <p className="text-xs text-muted-foreground">
              It works out at {dollars(worked)} with travel, whole hours and the {Math.round(GROSS_PROFIT_TARGET * 100)}% floor; the price is set at {dollars(total)}.
            </p>
          )}
        </>
      )}

      {/* The wording each area is quoted with is approved or declined on
          the site map before anybody prices it: until then there is
          nothing to accept, and it says so here instead of failing. */}
      {/* The wording each area is quoted with is approved or declined right
          here, before the price can be accepted: no leaving for the site map. */}
      {stage === "price" && needsWording && (
        <div className="flex flex-col gap-2 text-sm">
          <p className={cn("font-semibold", wordingDone ? "text-emerald-700 dark:text-emerald-300" : "text-amber-900 dark:text-amber-200")}>
            {wordingDone ? "Wording approved for every area." : `Approve or decline the wording for ${listed(item.wordingToApprove)} before accepting the price.`}
          </p>
          {preview ? (
            <p className="text-xs text-muted-foreground">On a real job, each area&apos;s recommended wording is shown here to approve or decline.</p>
          ) : (
            <ScopeReviewPanel jobId={item.jobId} onSettled={setWordingDone} />
          )}
        </div>
      )}

      {stage === "price" && unpriced.length > 0 && (
        <p className="rounded-xl border border-amber-400 bg-amber-50/70 p-3 text-sm font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {listed(unpriced)} {unpriced.length === 1 ? "comes" : "come"} to nothing. Put in the quantities, or add the services, before accepting.
        </p>
      )}

      {stage === "price" && (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending || !wordingDone || unpriced.length > 0} onClick={accept}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />}
            Accept price
          </Button>
          <Button type="button" variant="outline" className="h-14 text-base font-semibold" disabled={pending || !wordingDone} onClick={() => setStage("decline")}>
            <X className="mr-2 h-5 w-5" /> Decline price
          </Button>
        </div>
      )}

      {stage === "decline" && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <label htmlFor={`price-${item.jobId}`} className="text-sm font-semibold">
            What should the price be?
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id={`price-${item.jobId}`}
                inputMode="decimal"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={String(Math.round(total / 100))}
                className="h-12 pl-7 text-lg"
                autoFocus={!preview}
              />
            </div>
            <Button type="button" className="h-12 px-5 font-semibold" disabled={pending} onClick={() => submitPrice()}>
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Spread across the areas so they still add up. Nothing goes to the client yet.</p>
          <button type="button" className="self-start text-xs text-muted-foreground underline" onClick={() => setStage("price")}>
            Back
          </button>
        </div>
      )}

      {/* The last step, still on the card: the proposal as the client will
          see it, then Send to client. */}
      {stage === "send" && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Price accepted. Read it as the client will see it, then send it.
          </p>
          <EmailHeading>The email they&apos;ll get</EmailHeading>
          <ProposalEmailPreview
            key={sendTo ?? "none"}
            jobId={item.jobId}
            sample={
              preview
                ? {
                    ok: true,
                    to: "the client's email",
                    from: null,
                    replyTo: null,
                    ...proposalReadyEmail({
                      clientName: item.client,
                      address: item.address,
                      total: (total ?? 0) / 100,
                      discount: 0,
                      validDays: DEFAULT_VALID_DAYS,
                      link: clientLink ?? "",
                      businessName: "JS Landscaping",
                      signedBy: null,
                    }),
                  }
                : undefined
            }
          />
          {item.proposalHref && !preview && <EmailHeading>The proposal the link opens</EmailHeading>}
          {item.proposalHref && !preview && (
            <iframe
              src={`${item.proposalHref}${item.proposalHref.includes("?") ? "&" : "?"}embed=1`}
              title={`Proposal for ${item.client}`}
              className="h-[70vh] w-full rounded-xl border border-border bg-white"
            />
          )}
          {preview && item.proposalHref && (
            <a href={item.proposalHref} className="text-sm font-medium text-primary underline underline-offset-2">
              See the sample proposal
            </a>
          )}
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending || (!sendTo && !preview)} onClick={send}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
            Send to client
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {sendTo ? `It sends the email above to ${sendTo}.` : "No email on file, so it can't be emailed. Copy the link and text it to them."}
          </p>
          {!sendTo && clientLink && (
            <Button type="button" variant="outline" className="h-11" onClick={() => copyLink()}>
              <Copy className="mr-2 h-4 w-4" /> {copied ? "Copied" : "Copy the client's link"}
            </Button>
          )}
        </div>
      )}

      {stage === "sent" && (
        <div className="flex flex-col gap-1 rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
          <p className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Sent to {sendTo ?? "the client"}.
          </p>
          <p className="text-xs text-emerald-900/80 dark:text-emerald-200/80">
            It&apos;s with the client now. When they accept, decline, raise a concern or ask for a change, the team is told, and that&apos;s the next step.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </article>
  );
}

/**
 * Every product going in, with its photo, how much, what it costs, and a
 * link to see it: what the account manager is approving, not just a number.
 */
function Products({ products }: { products: PriceApproval["products"] }) {
  if (products.length === 0) return null;
  return (
    <div className="rounded-xl border border-border">
      <p className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Products going in
      </p>
      <ul className="divide-y divide-border">
        {products.map((p) => {
          const photo = p.imageUrl ? (
            // The inventory's photo of it, small.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt={p.name} className="h-14 w-14 shrink-0 rounded-lg bg-muted object-cover" loading="lazy" />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted text-xl" aria-hidden>
              📦
            </span>
          );
          const link = p.url ?? p.imageUrl;
          return (
            <li key={p.name} className="flex items-center gap-3 px-3 py-2">
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer">
                  {photo}
                </a>
              ) : (
                photo
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium leading-snug">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.amount}
                  {p.cents != null ? ` · ${dollars(p.cents)}` : " · no cost set"}
                </p>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary underline">
                    See the product
                  </a>
                ) : (
                  <Link href="/admin/tools" className="text-xs text-muted-foreground underline">
                    {p.inInventory ? "No link yet: add it in Inventory" : "Not in Inventory: add it with a photo and link"}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Zone 1", "Zone 1 and Zone 2", "Zone 1, Zone 2 and Zone 3". */
function listed(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Commission pool (15%)", "Jace's account manager fee (15%)", "Max's affiliate fee (5%)". */
function feeLabel(fee: JobFee): string {
  if (fee.kind === "pool") return `Commission pool (${fee.pct}%)`;
  const whose = fee.name === "Account manager" || fee.name === "Affiliate" ? "" : `${fee.name}'s `;
  return `${whose}${fee.kind === "affiliate" ? "affiliate" : "account manager"} fee (${fee.pct}%)`;
}

/**
 * What the price leaves: labour, materials and the fee taken off it, and the
 * gross profit, a visit at a time when the crew comes out more than once.
 * Under 50% it says the price that makes 50%, with a button to use it.
 */
function ProfitTable({
  item,
  total,
  pending,
  onUsePrice,
}: {
  item: PriceApproval;
  total: number;
  pending: boolean;
  onUsePrice: (cents: number) => void;
}) {
  const b = item.breakdown;
  const c = item.costs;
  const m = margin(total, c.labourCents, c.materialsCents, item.fee.pct);
  const visits = c.visits != null && c.visits > 1 ? c.visits : null;
  const floor = priceForTarget(c.labourCents, c.materialsCents, item.fee.pct, GROSS_PROFIT_TARGET, visits ?? 1);
  const target = Math.round(GROSS_PROFIT_TARGET * 100);
  const cell = (cents: number) => (visits ? [cents / visits, cents] : [cents]);
  const rows: { label: string; detail?: string; cents: number; strong?: boolean }[] = [
    { label: "Price to the client", cents: m.priceCents, strong: true },
    // Every hour the crew is on the clock, at the crew rate: on site, in the
    // truck, and the rest of the last hour.
    ...c.labour.map((l) => ({ label: l.label, detail: `${l.detail}, at ${dollars(item.crewRateCents)}/hr`, cents: l.cents })),
    {
      label: "Materials",
      detail: b.materialTotals.length > 0 ? b.materialTotals.map((x) => `${x.amount} ${x.name.toLowerCase()}${x.cents == null ? ", no cost set" : ""}`).join(" · ") : "None",
      cents: m.materialsCents,
    },
    { label: feeLabel(item.fee), detail: item.fee.shares ? item.fee.shares.join(" · ") : "of the price", cents: m.feeCents },
    { label: "Total cost", cents: m.costCents, strong: true },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Cost &amp; profit</th>
            {visits && <th className="px-3 py-1.5 text-right font-medium">Per visit</th>}
            <th className="px-3 py-1.5 text-right font-medium">{visits ? `All ${visits} visits` : "This job"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.label} className={r.strong ? "font-semibold" : undefined}>
              <td className="px-3 py-1.5 align-top">
                {r.label}
                {r.detail && <span className="block text-xs font-normal text-muted-foreground">{r.detail}</span>}
              </td>
              {cell(r.cents).map((c, i) => (
                <td key={i} className="px-3 py-1.5 text-right align-top tabular-nums">
                  {visits && i === 0 ? cents(c) : dollars(c)}
                </td>
              ))}
            </tr>
          ))}
          <tr className={cn("font-bold", m.meetsTarget ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-300")}>
            <td className="px-3 py-2">
              Gross profit
              <span className="block text-xs font-medium">{Math.round(m.grossPct * 100)}% of the price</span>
            </td>
            {cell(m.grossCents).map((c, i) => (
              <td key={i} className="px-3 py-2 text-right tabular-nums">
                {visits && i === 0 ? cents(c) : dollars(c)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {m.meetsTarget ? (
        <p className="border-t border-border px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
          At or above the {target}% gross profit every job needs.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-red-900 dark:text-red-300">
          <span>
            Under the {target}% gross profit every job needs.
            {floor != null && ` ${dollars(floor)}${visits ? ` (${dollars(floor / visits)} a visit)` : ""} leaves ${target}%.`}
          </span>
          {floor != null && (
            <Button type="button" size="sm" disabled={pending} onClick={() => onUsePrice(floor)}>
              Price it at {dollars(floor)}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Everything behind the price: the site map, what it costs and leaves, then each area with its photos. */
function Breakdown({
  item,
  total,
  pending,
  onUsePrice,
}: {
  item: PriceApproval;
  total: number;
  pending: boolean;
  onUsePrice: (cents: number) => void;
}) {
  const b = item.breakdown;
  return (
    <div className="flex flex-col gap-2">
      {item.siteMap && <PriceSiteMap map={item.siteMap} />}
      <ProfitTable item={item} total={total} pending={pending} onUsePrice={onUsePrice} />
      <Products products={item.products} />
      <details open className="rounded-xl border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
          {b.areas.length} area{b.areas.length === 1 ? "" : "s"}, area by area
        </summary>
        <ul className="flex flex-col divide-y divide-border">
          {b.areas.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex flex-col gap-1 px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 font-medium">
                  <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  {a.name} <span className="text-muted-foreground">· {a.service}</span>
                </p>
                <p className="shrink-0 font-semibold tabular-nums">{dollars(item.costs.areaPricesCents[i] ?? a.priceCents)}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {(a.visits > 1
                  ? // Salting: its hours are a visit at a time, in the table above.
                    [a.size ?? "not measured", `${dollars(a.materialsCents)} materials`]
                  : [a.size ?? "not measured", `${hours(a.crewHours)} crew-hrs on site, ${dollars(a.labourCents)} labour`, `${dollars(a.materialsCents)} materials`]
                ).join(" · ")}
              </p>
              {a.visits > 1 && (
                <p className="text-xs text-muted-foreground">
                  {a.visits} visits at {dollars((item.costs.areaPricesCents[i] ?? a.priceCents) / a.visits)} a visit
                </p>
              )}
              {a.materials.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {a.materials.map((m) => `${m.name}: ${m.amount}${m.cents != null ? `, ${dollars(m.cents)}` : ", no cost set"}`).join(" · ")}
                </p>
              )}
              {(item.areaPhotos[i] ?? []).length > 0 ? (
                <div className="mt-1 grid grid-cols-3 gap-1.5">
                  {item.areaPhotos[i].map((src) => (
                    // Thumbnails from the walkthrough, at the size shown.
                    <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`${a.name} on the walkthrough`} className="aspect-square w-full rounded-lg bg-muted object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No photos taken of this area.</p>
              )}
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted-foreground">
        Labour at {dollars(item.crewRateCents)} a crew-hour, marked up {item.markup}.
      </p>
      {b.warnings.map((w) => (
        <p key={w} className="rounded-lg bg-amber-100/70 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {w}
        </p>
      ))}
    </div>
  );
}
