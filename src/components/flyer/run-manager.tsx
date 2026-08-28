"use client";

import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createFlyerRun, setFlyerRunDate, setFlyerRunStatus } from "@/lib/actions/flyer-run-actions";
import { money, spotsLabel } from "@/lib/flyer-offer";
import type { FlyerRunRow } from "@/lib/data/flyer-runs";
import { RunSheet } from "@/components/flyer/run-sheet";

/**
 * Opening a run and working it.
 *
 * The public link sells whichever run is open, so the whole job here is: open
 * one, hand somebody the link, and watch the spots fill. Everything else is
 * reading.
 */
export function FlyerRunManager({
  runs,
  baseUrl,
  orgSlug,
  stripeReady,
}: {
  runs: FlyerRunRow[];
  baseUrl: string;
  orgSlug: string | null;
  /** Whether the pay button on the public link actually takes a card. */
  stripeReady: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const open = runs.find((r) => r.status === "open") ?? null;
  const past = runs.filter((r) => r.status !== "open");

  const link = orgSlug ? `${baseUrl}/flyer/${orgSlug}` : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Flyer runs</h2>
          <p className="text-xs text-muted-foreground">
            One run takes bookings at a time. The link always sells that one.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {adding ? "Cancel" : "Open a run"}
        </Button>
      </div>

      {adding && <NewRun onDone={() => setAdding(false)} />}

      {/* Said either way, on purpose. A warning that only appears when
          something is broken cannot be trusted when it is absent: not seeing
          it means "all is well" and "this build is not live yet" equally, and
          those are very different things to know before texting the link to
          fifty businesses. */}
      <p
        className={`rounded-lg border p-3 text-xs ${
          stripeReady
            ? "border-emerald-600/40 bg-emerald-50/60 text-emerald-900"
            : "border-destructive/50 bg-destructive/5 text-destructive"
        }`}
      >
        {stripeReady ? (
          <>
            <span className="font-semibold">Card payments are on.</span> Following the link,
            uploading an advert and paying by card all work.
          </>
        ) : (
          <>
            <span className="font-semibold">Card payments are off.</span> Anybody following the
            link can upload their advert, but the pay button will tell them to ring you instead of
            taking a card. Add STRIPE_SECRET_KEY in Vercel and redeploy.
          </>
        )}
      </p>

      {!orgSlug && (
        <p className="rounded-lg border border-amber-400/60 bg-amber-50/60 p-3 text-xs text-amber-900">
          Your business has no short name set, so there is no public link yet. Add one under
          Settings, Organizations.
        </p>
      )}

      {open ? (
        <OpenRun run={open} link={link} />
      ) : (
        !adding && (
          <p className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
            No run is taking bookings. Open one and the link goes live.
          </p>
        )
      )}

      {past.length > 0 && (
        <>
          <p className="mt-2 text-xs font-medium text-muted-foreground">Past runs</p>
          <ul className="flex flex-col gap-2">
            {past.map((run) => (
              <li key={run.id} className="rounded-xl border border-border bg-card/60 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{run.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {run.sold} sold · {money(run.takenCents)} · {run.status}
                  </span>
                </div>
                <ReopenButton runId={run.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function OpenRun({ run, link }: { run: FlyerRunRow; link: string | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [date, setDate] = useState(run.mailsOn ?? "");

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{run.name}</h3>
        <span className="text-xs font-medium text-primary">
          {run.sold} sold · {money(run.takenCents)} in
        </span>
      </div>

      <p className="text-sm">{spotsLabel(run.sold)}</p>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Goes out
        <Input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            start(async () => {
              await setFlyerRunDate({ runId: run.id, mailsOn: e.target.value || null });
            });
          }}
          className="h-9 w-auto"
        />
      </label>

      {link && (
        <div className="flex flex-col gap-2">
          <p className="truncate rounded-lg border border-border bg-background/70 px-3 py-2 text-xs">
            {link}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => copy(link, "link")}>
              {copied === "link" ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" />
              )}
              {copied === "link" ? "Copied" : "Copy link"}
            </Button>

            <Button type="button" variant="ghost" size="sm" asChild>
              <a href={link} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open it
              </a>
            </Button>
          </div>
          {copied === "failed" && (
            <p className="text-xs text-destructive">Couldn&apos;t copy. Select it by hand.</p>
          )}
        </div>
      )}

      {/* Both sides, as they would print. The office was told how many
          spots were sold and never shown the sheet, so the only way to know
          what a run looked like was to wait for the printer. */}
      <RunSheet runId={run.id} squares={run.squares} />

      <Bookings run={run} />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => start(async () => void (await setFlyerRunStatus({ runId: run.id, status: "closed" })))}
      >
        Close this run
      </Button>
    </div>
  );
}

function Bookings({ run }: { run: FlyerRunRow }) {
  if (run.bookings.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nobody has booked yet. Send the text to the businesses on your call list.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {run.bookings.map((booking) => {
        const paid = booking.status === "paid" || booking.status === "placed";
        return (
          <li
            key={booking.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-background/70 p-2"
          >
            {booking.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={booking.imageUrl}
                alt={`${booking.businessName} advert`}
                className="aspect-[4/4.75] w-10 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="aspect-[4/4.75] w-10 shrink-0 rounded bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{booking.businessName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {paid ? money(booking.amountCents ?? 0) : "Not paid"}
                {booking.slot ? ` · square ${booking.slot}` : ""}
                {booking.phone ? ` · ${booking.phone}` : ""}
              </p>
            </div>
            {booking.imageUrl && (
              <a
                href={booking.imageUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs font-medium text-primary underline"
              >
                Artwork
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReopenButton({ runId }: { runId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="mt-1 h-8"
      disabled={pending}
      onClick={() => start(async () => void (await setFlyerRunStatus({ runId, status: "open" })))}
    >
      Reopen for bookings
    </Button>
  );
}

function NewRun({ onDone }: { onDone: () => void }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [mailsOn, setMailsOn] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Run name, like October run"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Goes out
        <Input
          type="date"
          value={mailsOn}
          onChange={(e) => setMailsOn(e.target.value)}
          className="h-9 w-auto"
        />
      </label>
      <Button
        type="button"
        disabled={pending || !name.trim()}
        onClick={() =>
          start(async () => {
            const result = await createFlyerRun({ name, mailsOn });
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            onDone();
          })
        }
      >
        {pending ? "Opening…" : "Open it and go live"}
      </Button>
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
