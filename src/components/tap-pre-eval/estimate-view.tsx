"use client";

import { useState, useTransition } from "react";
import { Check, CheckCircle2, Info, Loader2, MessageCircleQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askEstimateQuestion, startEstimatePayment } from "@/lib/actions/tap-estimate-actions";
import type { ClientEstimate } from "@/lib/data/tap-estimate";
import { tierById, type EvaluationTier, type TierId } from "@/lib/evaluation-tiers";
import { choiceLabel, dollars } from "@/lib/tap-estimate";
import { clientSizeWords } from "@/lib/spot-size-words";

interface Message {
  id: string;
  fromClient: boolean;
  author: string;
  body: string;
  at: string;
}

export interface EstimateViewProps {
  token: string;
  businessName: string;
  businessPhone: string | null;
  clientFirstName: string | null;
  address: string | null;
  visit: string | null;
  estimate: ClientEstimate;
  mapUrl: string | null;
  photoUrls: Record<string, string>;
  messages: Message[];
  /** The paid evaluations on offer, for somebody not ready to put a deposit down. */
  tiers: EvaluationTier[];
  /** Where they pick the visit time once they've paid. */
  scheduleHref: string;
  mapHref: string;
}

/**
 * The estimate, laid out like the proposal a client gets after the visit
 * (same header, same scope then price then questions), and plain that it is
 * an estimate: worked out before anybody has seen the yard, confirmed at the
 * visit. Then the one decision, which is paid either way: a third down to
 * hold the job (the basic visit comes with it), or a paid evaluation for
 * somebody not ready to commit, whose fee comes off the job if they go ahead.
 */
export function EstimateView({
  token,
  businessName,
  businessPhone,
  clientFirstName,
  address,
  visit,
  estimate,
  mapUrl,
  photoUrls,
  messages: initialMessages,
  tiers,
  scheduleHref,
  mapHref,
}: EstimateViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [paying, startPaying] = useTransition();
  const [asking, startAsking] = useTransition();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState(initialMessages);

  // Each spot's size in words, by its place in the list. Estimates from
  // before sizes were kept have none, and show none.
  const sizingByIndex = new Map(estimate.sizing.map((s) => [s.index, s]));
  const sizeWords = estimate.spots.map((spot, i) => {
    const s = sizingByIndex.get(i);
    return s ? clientSizeWords(s, { hasPhotos: spot.photos.length > 0, traced: Boolean(spot.outline) }) : null;
  });
  const priced = estimate.price.lines.filter((l) => l.priceCents != null);
  const atVisit = estimate.price.lines.filter((l) => l.priceCents == null);
  const hasPrice = estimate.totalCents > 0;
  const paid = Boolean(estimate.paidAt);
  const [tierId, setTierId] = useState<TierId>(hasPrice ? "measured" : "basic");
  const tier = tierById(tiers, tierId);
  const paidTier = tierById(tiers, estimate.evaluationTier);

  function pay(choice: "deposit" | TierId) {
    setError(null);
    startPaying(async () => {
      const result = await startEstimatePayment({ token, pay: choice });
      if (!result.ok) setError(result.error);
      else window.location.assign(result.url);
    });
  }

  function ask() {
    setError(null);
    const body = question.trim();
    startAsking(async () => {
      const result = await askEstimateQuestion({ token, body });
      if (!result.ok) return setError(result.error);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), fromClient: true, author: clientFirstName ?? "You", body, at: new Date().toISOString() }]);
      setQuestion("");
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{businessName}</p>
        <h1 className="text-2xl font-bold">Your Estimate</h1>
        <p className="text-muted-foreground">
          {clientFirstName ? `Prepared for ${clientFirstName}` : "Prepared for you"}
          {address ? ` · ${address}` : ""}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          From the spots you marked and your photos, here&apos;s what we&apos;d do and what we expect it to come to.
        </p>
      </div>

      {paid && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-primary/40! bg-primary/5 p-4">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="flex flex-1 flex-col gap-2">
            <p className="font-semibold">
              {estimate.choice === "evaluation" ? `${paidTier?.name ?? "Evaluation"} booked and paid.` : "Deposit received. You're all set."}
            </p>
            <p className="text-sm text-muted-foreground">
              {visit
                ? `We'll see you ${visit}. `
                : ""}
              {estimate.choice === "evaluation"
                ? "If you go ahead with the project, what you paid comes off the price."
                : "We confirm everything at the visit, and your deposit comes off the final price."}
            </p>
            {!visit && (
              <Button asChild size="lg" className="self-start">
                <a href={scheduleHref}>Pick your visit time</a>
              </Button>
            )}
          </div>
        </div>
      )}

      {mapUrl && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Your property</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mapUrl} alt="Your property with the spots you marked" className="w-full rounded-2xl border border-border" />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What you asked for</h2>
        {estimate.spots.map((spot, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl border border-border p-4">
            <p className="flex items-start gap-3 font-semibold">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
              <span className="pt-0.5">
                {spot.choices.map(choiceLabel).join(", ")}
                {sizeWords[i] && <span className="block text-sm font-normal text-muted-foreground">{sizeWords[i]}</span>}
              </span>
            </p>
            {spot.photos.some((p) => photoUrls[p]) && (
              <div className="grid grid-cols-3 gap-2">
                {spot.photos
                  .filter((p) => photoUrls[p])
                  .map((path) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={path} src={photoUrls[path]} alt={`Spot ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" />
                  ))}
              </div>
            )}
          </div>
        ))}
        {!paid && (
          <a href={mapHref} className="self-start text-sm font-semibold text-primary underline-offset-2 hover:underline">
            Change my spots
          </a>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Scope of work</h2>
        <ul className="flex flex-col gap-2 rounded-2xl border border-border p-4">
          {priced.map((line, i) => (
            <li key={`p-${i}`} className="flex items-start justify-between gap-3 border-t border-border/60 pt-2 first:border-0 first:pt-0">
              <span>
                <span className="font-medium">{line.label}</span>
                {line.size && <span className="block text-sm text-muted-foreground">About {line.size}</span>}
              </span>
            </li>
          ))}
          {atVisit.map((line, i) => (
            <li key={`v-${i}`} className="flex items-start justify-between gap-3 border-t border-border/60 pt-2 first:border-0 first:pt-0">
              <span>
                <span className="font-medium">{line.label}</span>
                <span className="block text-sm text-muted-foreground">We&apos;ll price this one at your visit.</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {hasPrice ? (
        <section className="flex flex-col items-center gap-1 rounded-2xl border border-primary/30! bg-primary/5 p-6 text-center">
          <p className="text-sm font-medium text-muted-foreground">Estimated total</p>
          <p className="text-4xl font-bold text-primary">{dollars(estimate.totalCents)}</p>
          {atVisit.length > 0 && <p className="text-sm text-muted-foreground">Plus anything we price at your visit.</p>}
          <p className="mt-3 text-base font-semibold">
            {paid
              ? `Paid: ${dollars(estimate.chargedCents ?? 0)}, comes off your project`
              : `Deposit to hold your spot: ${dollars(estimate.depositCents)} (one third)`}
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-border p-6 text-center">
          <p className="font-semibold">We&apos;ll price this at your visit</p>
          <p className="mt-1 text-sm text-muted-foreground">What you asked for needs a look in person before we can put a number on it.</p>
        </section>
      )}

      <section className="flex gap-3 rounded-2xl border border-amber-500/40! bg-amber-500/10 p-4 text-sm">
        <Info className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div className="flex flex-col gap-2">
          <p className="font-semibold">This is an estimate, not the final price</p>
          <p>
            We worked it out from your photos and the county&apos;s map of your lot, before seeing the yard in person. The
            final price can change if we find something we couldn&apos;t see, like:
          </p>
          <ul className="list-disc pl-5">
            <li>Rock, roots or old fabric buried under the beds</li>
            <li>More beds or a bigger area than the photos show</li>
            <li>Drainage or grading problems under the surface</li>
            <li>Extra debris or overgrowth to haul away</li>
          </ul>
          <p>We confirm everything at your visit. If anything changes, you&apos;ll see the new price in writing before any work starts, and your deposit comes off it.</p>
        </div>
      </section>

      {error && <p className="text-center text-sm font-medium text-destructive">{error}</p>}

      {!paid && (
        <section className="flex flex-col gap-4">
          {hasPrice && (
            <div className="flex flex-col gap-3 rounded-2xl border-2 border-primary! p-4">
              <div>
                <h2 className="text-lg font-semibold">Ready to go ahead?</h2>
                <p className="text-sm text-muted-foreground">
                  Put down {dollars(estimate.depositCents)} (one third) to hold your spot. Your site evaluation is included, and the
                  deposit comes off your final price.
                </p>
              </div>
              <Button size="xl" className="w-full" disabled={paying} onClick={() => pay("deposit")}>
                {paying ? <Loader2 className="size-6 animate-spin" /> : `Accept and pay ${dollars(estimate.depositCents)} deposit`}
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
            <div>
              <h2 className="text-lg font-semibold">{hasPrice ? "Not ready yet? Book an evaluation" : "Book an evaluation"}</h2>
              <p className="text-sm text-muted-foreground">We come out and go over everything with you. If you go ahead, what you pay comes off the project.</p>
            </div>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Evaluations">
              {tiers.map((t) => {
                const on = t.id === tierId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTierId(t.id)}
                    className={on ? "rounded-xl border-2 border-primary! bg-primary/5 p-3 text-left" : "rounded-xl border-2 border-border p-3 text-left"}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{t.name}</span>
                      <span className="font-semibold text-primary">{dollars(t.priceCents)}</span>
                    </span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{t.blurb}</span>
                    {on && (
                      <ul className="mt-2 flex flex-col gap-1 text-sm">
                        {t.includes.map((item) => (
                          <li key={item} className="flex items-start gap-2">
                            <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
            </div>
            <Button size="lg" variant={hasPrice ? "outline" : "default"} className="w-full" disabled={paying || !tier} onClick={() => pay(tierId)}>
              {paying ? <Loader2 className="size-5 animate-spin" /> : tier ? `Book ${tier.name} for ${dollars(tier.priceCents)}` : "Pick one"}
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Card, Apple Pay or Google Pay. A 3.5% card processing fee is added at checkout. You pick your visit time right after.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MessageCircleQuestion className="size-5 text-primary" /> Questions?
        </h2>
        {messages.length > 0 && (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id} className={m.fromClient ? "self-end rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground" : "self-start rounded-2xl bg-muted px-3 py-2 text-sm"}>
                {!m.fromClient && <span className="block text-xs font-semibold">{m.author}</span>}
                {m.body}
              </li>
            ))}
          </ul>
        )}
        <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask us anything about your estimate" rows={3} />
        <Button variant="outline" size="lg" disabled={asking || !question.trim()} onClick={ask}>
          {asking ? <Loader2 className="size-5 animate-spin" /> : "Send question"}
        </Button>
        {businessPhone && (
          <p className="text-center text-sm text-muted-foreground">
            Or call or text <a className="font-semibold text-primary" href={`tel:${businessPhone}`}>{businessPhone}</a>
          </p>
        )}
      </section>
    </div>
  );
}
