"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Info, Loader2, MessageCircleQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askEstimateQuestion, startEstimateDeposit } from "@/lib/actions/tap-estimate-actions";
import type { ClientEstimate } from "@/lib/data/tap-estimate";
import { choiceLabel, dollars } from "@/lib/tap-estimate";

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
  justPaid: boolean;
  mapHref: string;
}

/**
 * The estimate, laid out like the proposal a client gets after the visit
 * (same header, same scope then price then questions), and plain that it is
 * an estimate: worked out before anybody has seen the yard, confirmed at the
 * visit, with a third down to hold it.
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
  justPaid,
  mapHref,
}: EstimateViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [paying, startPaying] = useTransition();
  const [asking, startAsking] = useTransition();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState(initialMessages);

  const priced = estimate.price.lines.filter((l) => l.priceCents != null);
  const atVisit = estimate.price.lines.filter((l) => l.priceCents == null);
  const hasPrice = estimate.totalCents > 0;
  const paid = Boolean(estimate.depositPaidAt);

  function payDeposit() {
    setError(null);
    startPaying(async () => {
      const result = await startEstimateDeposit(token);
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
        <div className="flex items-start gap-3 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">Deposit received. You&apos;re all set.</p>
            <p className="text-sm text-muted-foreground">
              {visit ? `We'll see you ${visit}. ` : ""}We confirm everything at the visit, and your deposit comes off the final price.
            </p>
          </div>
        </div>
      )}
      {justPaid && !paid && (
        <p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm">
          Thanks! Your payment is going through. This page will show it as received in a minute or two.
        </p>
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
              <span className="pt-0.5">{spot.choices.map(choiceLabel).join(", ")}</span>
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
        {!estimate.acceptedAt && (
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
        <section className="flex flex-col items-center gap-1 rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center">
          <p className="text-sm font-medium text-muted-foreground">Estimated total</p>
          <p className="text-4xl font-bold text-primary">{dollars(estimate.totalCents)}</p>
          {atVisit.length > 0 && <p className="text-sm text-muted-foreground">Plus anything we price at your visit.</p>}
          <p className="mt-3 text-base font-semibold">
            {paid ? `Deposit paid: ${dollars(estimate.depositCents)}` : `To hold your spot: ${dollars(estimate.depositCents)} deposit (one third)`}
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-border p-6 text-center">
          <p className="font-semibold">We&apos;ll price this at your visit</p>
          <p className="mt-1 text-sm text-muted-foreground">What you asked for needs a look in person before we can put a number on it.</p>
        </section>
      )}

      <section className="flex gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
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

      {hasPrice && !paid && (
        <div className="flex flex-col gap-2">
          <Button size="xl" className="w-full" disabled={paying} onClick={payDeposit}>
            {paying ? <Loader2 className="size-6 animate-spin" /> : estimate.acceptedAt ? `Finish paying your ${dollars(estimate.depositCents)} deposit` : `Accept and pay ${dollars(estimate.depositCents)} deposit`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Card, Apple Pay or Google Pay. A 3.5% card processing fee is added at checkout.</p>
        </div>
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
