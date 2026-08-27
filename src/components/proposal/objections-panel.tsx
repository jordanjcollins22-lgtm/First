"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Check, CreditCard, MessageCircleQuestion, Scissors } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  availableResolutions,
  OBJECTIONS,
  reduceScope,
  shouldOfferOther,
  type Objection,
  type ResolutionKind,
  type ScopeLine,
} from "@/lib/objections";
import { recordObjection, requestScopeChange } from "@/lib/actions/public-proposal-actions";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const RESOLUTION_LABEL: Record<ResolutionKind, string> = {
  explain: "That answers it",
  payment_plan: "Split it into payments",
  reduce_scope: "Let me pick what to keep",
  talk: "I'd rather talk it through",
};

const RESOLUTION_ICON: Record<ResolutionKind, typeof CreditCard> = {
  explain: Check,
  payment_plan: CreditCard,
  reduce_scope: Scissors,
  talk: CalendarClock,
};

/**
 * The questions section at the foot of a client's proposal.
 *
 * Every button is an objection this business already hears, and opening one
 * shows the answer it already gives. Where that answer is something we can do
 * — spread the payments, trim the work — the next tap does it rather than
 * promising an email.
 */
export function ObjectionsPanel({
  token,
  lines,
  disabled,
}: {
  token: string;
  lines: ScopeLine[];
  /** Already accepted or declined — the questions have had their moment. */
  disabled: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [settled, setSettled] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);

  if (disabled) return null;

  const open = openId ? OBJECTIONS.find((o) => o.id === openId) ?? null : null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MessageCircleQuestion className="h-5 w-5" />
          Questions before you decide?
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick whichever is closest — most of these we can sort out right here.
        </p>
      </div>

      {settled && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">{settled}</p>
      )}

      {!open ? (
        <>
          <ul className="flex flex-col gap-2">
            {OBJECTIONS.map((objection) => (
              <li key={objection.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(objection.id);
                    setSettled(null);
                    void recordObjection({ token, objectionId: objection.id });
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm font-medium hover:bg-muted"
                >
                  {objection.label}
                </button>
              </li>
            ))}
          </ul>

          {/* Only once we have failed to answer something. Offered up front it
              becomes the easy path and every objection arrives as free text —
              which is the pile the buttons above exist to empty. */}
          {shouldOfferOther({ rejected }) && (
            <OtherBox
              token={token}
              open={showOther}
              onOpen={() => setShowOther(true)}
              onSent={() => {
                setShowOther(false);
                setSettled("Thanks — we've got that and someone will come back to you.");
              }}
            />
          )}
        </>
      ) : (
        <AnswerCard
          token={token}
          objection={open}
          lines={lines}
          onClose={() => setOpenId(null)}
          onRejected={() => {
            setRejected((r) => (r.includes(open.id) ? r : [...r, open.id]));
            setOpenId(null);
            setShowOther(true);
          }}
          onSettled={(message) => {
            setSettled(message);
            setOpenId(null);
          }}
        />
      )}
    </section>
  );
}

function AnswerCard({
  token,
  objection,
  lines,
  onClose,
  onRejected,
  onSettled,
}: {
  token: string;
  objection: Objection;
  lines: ScopeLine[];
  onClose: () => void;
  onRejected: () => void;
  onSettled: (message: string) => void;
}) {
  const [trimming, setTrimming] = useState(false);
  const resolutions = availableResolutions(objection, lines);

  if (trimming) {
    return (
      <ScopePicker
        token={token}
        lines={lines}
        onCancel={() => setTrimming(false)}
        onDone={onSettled}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <p className="text-sm font-semibold">{objection.label}</p>
      <p className="text-sm text-muted-foreground">{objection.answer}</p>

      <div className="flex flex-col gap-2">
        {resolutions.map((kind) => {
          const Icon = RESOLUTION_ICON[kind];
          return (
            <Button
              key={kind}
              type="button"
              variant={kind === "explain" ? "default" : "outline"}
              className="w-full justify-start gap-2"
              onClick={() => {
                if (kind === "reduce_scope") {
                  setTrimming(true);
                  return;
                }
                void recordObjection({
                  token,
                  objectionId: objection.id,
                  resolution: kind,
                  resolved: true,
                });
                onSettled(
                  kind === "payment_plan"
                    ? "Good — we'll send you the payment options to look over. Accept whenever you're ready."
                    : kind === "talk"
                      ? "No problem — we'll call you to talk it through."
                      : "Glad that helped."
                );
              }}
            >
              <Icon className="h-4 w-4" />
              {RESOLUTION_LABEL[kind]}
            </Button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
          Back
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="flex-1 text-muted-foreground"
          onClick={() => {
            void recordObjection({ token, objectionId: objection.id, resolved: false });
            onRejected();
          }}
        >
          That doesn&apos;t help
        </Button>
      </div>
    </div>
  );
}

/**
 * Pick what to keep, and watch the price move.
 *
 * The total updates as boxes are unticked, using the prices captured when the
 * proposal was generated — so what a client sees here is their quote minus an
 * area, not today's rate card. Where a price cannot stand on its own the
 * figure is withheld rather than guessed, and the card says a person will
 * confirm it.
 */
function ScopePicker({
  token,
  lines,
  onCancel,
  onDone,
}: {
  token: string;
  lines: ScopeLine[];
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [keep, setKeep] = useState<string[]>(lines.map((l) => l.zoneName));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const preview = reduceScope(lines, keep);
  const nothingDropped = preview.droppedNames.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <div>
        <p className="text-sm font-semibold">Pick what you&apos;d like to keep</p>
        <p className="text-sm text-muted-foreground">
          Untick anything you&apos;d rather leave for another time.
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {lines.map((line) => {
          const on = keep.includes(line.zoneName);
          return (
            <li key={line.zoneName}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setKeep((k) =>
                      on ? k.filter((n) => n !== line.zoneName) : [...k, line.zoneName]
                    )
                  }
                  className="h-4 w-4"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${on ? "font-medium" : "text-muted-foreground line-through"}`}>
                    {line.zoneName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {line.serviceLabel}
                  </span>
                </span>
                {line.priceCents != null && (
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {money(line.priceCents)}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      {!nothingDropped && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          {preview.auto && preview.newTotalCents != null ? (
            <p className="text-sm">
              New total: <span className="font-bold">{money(preview.newTotalCents)}</span>
              <span className="text-muted-foreground"> — saving {money(preview.droppedCents)}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {preview.reviewReason ?? "We'll confirm the new price with you."}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={pending || nothingDropped || keep.length === 0}
          onClick={() => {
            setError(null);
            start(async () => {
              const result = await requestScopeChange({ token, keepZones: keep });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              onDone(
                result.applied && result.newTotalCents != null
                  ? `Done — your quote is now ${money(result.newTotalCents)}. Refresh to see the updated scope.`
                  : result.reviewReason ??
                      "Thanks — we'll confirm the new price with you shortly."
              );
            });
          }}
        >
          {pending ? "Updating…" : "Update my quote"}
        </Button>
      </div>
    </div>
  );
}

/** The last resort, and deliberately the hardest thing on the page to reach. */
function OtherBox({
  token,
  open,
  onOpen,
  onSent,
}: {
  token: string;
  open: boolean;
  onOpen: () => void;
  onSent: () => void;
}) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={onOpen}>
        Something else
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        placeholder="What's on your mind? We'll come back to you."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
      />
      <Button
        type="button"
        className="w-full"
        disabled={pending || !note.trim()}
        onClick={() =>
          start(async () => {
            await recordObjection({ token, objectionId: "other", note, resolved: false });
            setNote("");
            onSent();
          })
        }
      >
        {pending ? "Sending…" : "Send"}
      </Button>
    </div>
  );
}
