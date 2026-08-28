"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Phone, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addFlyerBusiness, logFlyerTouch } from "@/lib/actions/flyer-outreach-actions";
import {
  callOrder,
  outcomeLabel,
  OUTCOMES,
  outreachLabel,
  outreachTotals,
  since,
} from "@/lib/flyer-outreach";
import type { FlyerBusiness } from "@/lib/data/flyer-outreach";

/**
 * The call list for flyer spots.
 *
 * Selling seven tiles means ringing far more than seven businesses, and what
 * decides whether that works is memory, not effort: who was called, how often,
 * and what they said. Without it the same shop gets rung three times in a
 * fortnight and the one who said "call me in March" never gets called at all.
 */
export function FlyerOutreachList({ businesses }: { businesses: FlyerBusiness[] }) {
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const totals = outreachTotals(businesses.map((b) => b.summary));
  // Never tried first, then whoever has waited longest. Sorting by "most
  // promising" sounds better and is how the bottom of a list never gets rung.
  const toCall = callOrder(businesses);
  const done = businesses.filter((b) => !toCall.some((c) => c.id === b.id));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Businesses to call</h2>
          <p className="text-xs text-muted-foreground">
            {totals.businesses} on the list · {totals.contacted} contacted · {totals.interested}{" "}
            interested · {totals.sold} sold
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {adding ? "Cancel" : "Add business"}
        </Button>
      </div>

      {adding && <AddBusiness onDone={() => setAdding(false)} />}

      {businesses.length === 0 && !adding && (
        <p className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
          Nobody on the list yet. Add the first business you want to approach.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {toCall.map((business) => (
          <BusinessRow
            key={business.id}
            business={business}
            open={openId === business.id}
            onToggle={() => setOpenId(openId === business.id ? null : business.id)}
          />
        ))}
      </ul>

      {done.length > 0 && (
        <>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            Sold or asked not to be called ({done.length})
          </p>
          <ul className="flex flex-col gap-2">
            {done.map((business) => (
              <BusinessRow
                key={business.id}
                business={business}
                open={openId === business.id}
                onToggle={() => setOpenId(openId === business.id ? null : business.id)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function BusinessRow({
  business,
  open,
  onToggle,
}: {
  business: FlyerBusiness;
  open: boolean;
  onToggle: () => void;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  function log(outcome: string) {
    setError(null);
    start(async () => {
      const result = await logFlyerTouch({ customerId: business.id, outcome, note });
      if (result.ok) setNote("");
      else setError(result.message);
    });
  }

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{business.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {outreachLabel(business.summary, now)}
          </span>
          {business.summary.lastNote && (
            <span className="mt-0.5 block truncate text-xs italic text-muted-foreground">
              &ldquo;{business.summary.lastNote}&rdquo;
            </span>
          )}
        </span>
        {business.phone && (
          <a
            href={`tel:${business.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-lg border border-border p-2"
            aria-label={`Call ${business.name}`}
          >
            <Phone className="h-4 w-4" />
          </a>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="border-t border-border/60 p-3">
          <p className="mb-1.5 text-xs font-medium">What did they say?</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {OUTCOMES.map((outcome) => (
              <Button
                key={outcome.value}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => log(outcome.value)}
              >
                {outcome.label}
              </Button>
            ))}
          </div>

          {/* Typed before the button is pressed, so one tap records both what
              they said and why. */}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Notes: what they said, when to try again…"
            rows={2}
            className="text-sm"
          />
          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}

          {business.touches.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-t border-border/60 pt-2">
              {business.touches.map((touch, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium">{outcomeLabel(touch.outcome)}</span>{" "}
                  {since(touch.at, now)}
                  {touch.note && <span className="italic"> · &ldquo;{touch.note}&rdquo;</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function AddBusiness({ onDone }: { onDone: () => void }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" />
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" type="tel" />
      <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything worth remembering before you ring"
        rows={2}
      />
      <Button
        type="button"
        disabled={pending || !name.trim()}
        onClick={() =>
          start(async () => {
            const result = await addFlyerBusiness({ name, phone, email, notes });
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            setName("");
            setPhone("");
            setEmail("");
            setNotes("");
            setMessage(result.message ?? null);
            onDone();
          })
        }
      >
        {pending ? "Adding…" : "Add to the list"}
      </Button>
      {message && <p className="text-xs">{message}</p>}
    </div>
  );
}
