"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { declineTip, startTip, type TipAsk } from "@/lib/actions/public-tip-actions";

/**
 * The one question this page asks.
 *
 * Three things are deliberate and all three are about not being grabby.
 *
 * "No thanks" is a real button, the same size as the others, not a grey line
 * of small print. A tip prompt with no way past it is a toll, it reads as one,
 * and it costs more in goodwill than it collects.
 *
 * The suggestions are round numbers and the largest is never first. A default
 * that leads with the biggest figure is a nudge, people know it is a nudge,
 * and being nudged at the end of a job they were happy with is what turns a
 * thank-you into a transaction.
 *
 * And the message box is above the amounts, not below, because for a good
 * number of people the message is the tip. Somebody who writes two lines about
 * the crew and leaves nothing has still given them something worth having, and
 * the page should not treat that as the consolation prize.
 */
export function TipView({ ask }: { ask: TipAsk }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saidNo, setSaidNo] = useState(false);

  if (ask.status === "paid") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Thank you.</h1>
        <p className="text-sm text-muted-foreground">
          {ask.paidLabel ? `${ask.paidLabel} went to the crew.` : "That went to the crew."} They will
          hear about it.
        </p>
      </Shell>
    );
  }

  if (saidNo) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">No problem at all.</h1>
        <p className="text-sm text-muted-foreground">
          Thank you for having us. If anything about the work is not right, tell us and we will come
          back.
        </p>
        <button
          type="button"
          onClick={() => setSaidNo(false)}
          className="self-start text-xs text-muted-foreground underline"
        >
          Actually, I changed my mind
        </button>
      </Shell>
    );
  }

  function pay(amount: string | number) {
    setError(null);
    start(async () => {
      const result = await startTip({ token: ask.token, amount, message });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.href = result.url;
    });
  }

  function no() {
    start(async () => {
      await declineTip(ask.token);
      setSaidNo(true);
      router.refresh();
    });
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold">All finished. Thank you.</h1>
      <p className="text-sm text-muted-foreground">
        {ask.address ? `The work at ${ask.address} is done.` : "The work is done."} If the crew did
        right by you and you would like to leave them something, here is the place. It is entirely
        up to you, and nobody will think less of anybody either way.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">A word for the crew</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Anything you'd like them to hear."
          className="rounded-md border border-border bg-background p-2 text-sm"
        />
      </label>

      {!ask.canCharge ? (
        <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          Card payments are not switched on yet. If you would like to leave something, tell the crew
          directly.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              Leave something
              {ask.jobTotalLabel && (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  on a {ask.jobTotalLabel} job
                </span>
              )}
            </span>
            <div className="grid grid-cols-3 gap-2">
              {ask.options.map((option) => (
                <button
                  key={option.cents}
                  type="button"
                  disabled={pending}
                  onClick={() => pay(option.cents / 100)}
                  className="flex min-h-14 flex-col items-center justify-center rounded-lg border border-border hover:bg-accent"
                >
                  <span className="text-base font-semibold tabular-nums">{option.label}</span>
                  {option.note && (
                    <span className="text-[11px] text-muted-foreground">{option.note}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="Another amount"
              className="h-11 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            />
            <button
              type="button"
              disabled={pending || custom.trim() === ""}
              onClick={() => pay(custom)}
              className={cn(
                "h-11 rounded-md border border-border px-4 text-sm",
                custom.trim() === "" ? "opacity-50" : "hover:bg-accent"
              )}
            >
              Leave it
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={no}
        className="min-h-11 rounded-md border border-border px-4 text-sm hover:bg-accent"
      >
        No thanks
      </button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <p className="text-xs text-muted-foreground">
        {ask.note ?? `Anything left here goes to the people who did the work.`}
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">{children}</div>
  );
}
