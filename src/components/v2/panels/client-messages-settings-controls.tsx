"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fileCallOutcome,
  saveSequenceSetting,
  settleAutomationException,
  startCampaign,
  type ActionResult,
} from "@/lib/actions/client-automation-actions";
import { OUTCOMES } from "@/lib/call-list";
import type { CampaignPreview } from "@/lib/data/client-campaigns";
import type { SequenceConfig, SequenceKey } from "@/lib/client-automations/settings";
import { OpenEntityName } from "@/components/v2/panels/sales/open-entity-button";

/**
 * The interactive parts of Sales › Automated messages: switches, timings,
 * the review link, the campaign buttons, and the one-tap answers on the
 * "needs you" strip. Every button goes through an owner-checked action.
 */

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return <p className={`text-xs ${result.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{result.message}</p>;
}

/** On/off for one sequence, with when it went live underneath. */
export function SequenceSwitch({
  sequence,
  label,
  why,
  enabled,
  startedAt,
  disabledReason,
  children,
}: {
  sequence: SequenceKey;
  label: string;
  why: string;
  enabled: boolean;
  startedAt: string | null;
  /** Said instead of letting it be switched on, e.g. no review link yet. */
  disabledReason?: string | null;
  children?: React.ReactNode;
}) {
  const [on, setOn] = useState(enabled);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const flip = () =>
    start(async () => {
      const next = !on;
      const r = await saveSequenceSetting({ sequence, enabled: next });
      setResult(r);
      if (r.ok) setOn(next);
    });
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold">{label}</p>
          <p className="text-sm text-muted-foreground">{why}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {on
              ? startedAt
                ? `On since ${new Date(startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Only acts on what has happened since.`
                : "On from now. Only acts on what happens from here."
              : startedAt
                ? "Off. Nothing sends."
                : "Off. Switching it on never reaches back to older records."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${label} ${on ? "on" : "off"}`}
          disabled={pending || (!on && Boolean(disabledReason))}
          onClick={flip}
          className={`relative inline-flex min-h-11 min-w-16 shrink-0 items-center rounded-full border px-1 transition-colors disabled:opacity-50 ${on ? "bg-emerald-600" : "bg-muted"}`}
        >
          <span className={`h-8 w-8 rounded-full bg-background shadow transition-transform ${on ? "translate-x-6" : ""}`} />
        </button>
      </div>
      {!on && disabledReason && <p className="mt-2 text-xs font-medium text-orange-800 dark:text-orange-200">{disabledReason}</p>}
      <Result result={result} />
      {children && <div className="mt-3 border-t pt-3">{children}</div>}
    </div>
  );
}

/** A list of days ("3, 7, 14") or one number, saved into the sequence's config. */
export function TimingField({
  sequence,
  enabled,
  label,
  field,
  value,
  suffix,
}: {
  sequence: SequenceKey;
  enabled: boolean;
  label: string;
  field: keyof SequenceConfig;
  value: number | number[] | string;
  suffix?: string;
}) {
  const [text, setText] = useState(Array.isArray(value) ? value.join(", ") : String(value));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const parsed: SequenceConfig[keyof SequenceConfig] = Array.isArray(value)
        ? text.split(/[\s,]+/).filter(Boolean).map(Number)
        : typeof value === "number"
          ? Number(text)
          : text.trim();
      setResult(await saveSequenceSetting({ sequence, enabled, config: { [field]: parsed } as SequenceConfig }));
    });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs font-semibold">
        {label}
        <span className="flex items-center gap-1.5">
          <Input value={text} onChange={(e) => setText(e.target.value)} className="min-h-11 w-40" />
          {suffix && <span className="text-xs font-normal text-muted-foreground">{suffix}</span>}
        </span>
      </label>
      <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={save}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
      </Button>
      <Result result={result} />
    </div>
  );
}

/** The Google review link: where a five-star rating is sent. */
export function ReviewLinkField({ enabled, value }: { enabled: boolean; value: string }) {
  const [link, setLink] = useState(value);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-1.5">
      <label className="grid gap-1 text-xs font-semibold">
        Google review link
        <Input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://g.page/r/…/review"
          inputMode="url"
          className="min-h-11"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        In Google Business Profile, choose &ldquo;Ask for reviews&rdquo; and copy the link. Fives go straight there; anything lower comes to you first.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={pending}
          onClick={() => start(async () => setResult(await saveSequenceSetting({ sequence: "review_requests", enabled, config: { googleReviewLink: link } })))}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save link"}
        </Button>
        <Result result={result} />
      </div>
    </div>
  );
}

/** One owner-started campaign: who it reaches, and the button. */
export function CampaignCard({ title, why, preview, quietNow }: { title: string; why: string; preview: CampaignPreview; quietNow: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const reaching = preview.rows.filter((r) => !r.skip);
  const notReaching = preview.rows.filter((r) => r.skip);
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {title} <span className="font-normal text-muted-foreground">· {preview.season}</span>
          </p>
          <p className="text-sm text-muted-foreground">{why}</p>
          {preview.dueOn && (
            <p className="mt-1 text-xs text-muted-foreground">
              Season starts {preview.startsOn}; best sent by {preview.dueOn}.
            </p>
          )}
          {preview.lastRun && (
            <p className="mt-1 text-xs text-muted-foreground">
              Last started {new Date(preview.lastRun.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: {preview.lastRun.sent} sent.
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl">{reaching.length}</p>
          <p className="text-xs text-muted-foreground">will get it</p>
        </div>
      </div>

      <button type="button" onClick={() => setOpen(!open)} className="mt-2 min-h-11 text-sm font-semibold underline">
        {open ? "Hide the list" : `Preview who gets it (${preview.rows.length} looked at)`}
      </button>
      {open && (
        <ul className="mt-2 grid max-h-80 gap-1 overflow-y-auto">
          {[...reaching, ...notReaching].map((r) => (
            <li key={r.customerId} className="grid gap-0.5 rounded-lg bg-muted px-3 py-2 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,12rem)] sm:gap-3">
              <OpenEntityName entity={{ kind: "sales.client", id: r.customerId }} name={r.name} className="font-semibold" />
              <span className="text-muted-foreground">{r.detail}</span>
              <span className={r.skip ? "text-muted-foreground" : ""}>{r.skip ?? r.channels.map((c) => (c === "sms" ? "Text" : "Email")).join(" + ")}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setResult(await startCampaign(preview.campaign));
                  setConfirm(false);
                })
              }
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Yes, send to ${reaching.length}`}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setConfirm(false)}>
              Not yet
            </Button>
          </>
        ) : (
          <Button type="button" className="min-h-11" disabled={reaching.length === 0} onClick={() => setConfirm(true)}>
            <Send className="mr-1.5 h-4 w-4" /> Start {title.toLowerCase()}
          </Button>
        )}
        {quietNow && <p className="text-xs text-orange-800 dark:text-orange-200">It&apos;s outside sending hours: texts would wait. Start it in the morning.</p>}
      </div>
      <Result result={result} />
    </div>
  );
}

/** Done or dismiss, for one item on the "needs you" strip. */
export function ExceptionButtons({ id }: { id: string }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Result result={result} />;
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" className="min-h-11" disabled={pending} onClick={() => start(async () => setResult(await settleAutomationException(id, "resolved")))}>
        Done
      </Button>
      <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={pending} onClick={() => start(async () => setResult(await settleAutomationException(id, "dismissed")))}>
        Dismiss
      </Button>
      <Result result={result} />
    </div>
  );
}

/** One tap: what the client said on a call that connected. */
export function CallDisposition({ callId }: { callId: string }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Result result={result} />;
  // The ones that need no date: a date-picking outcome uses its default.
  return (
    <div className="flex flex-wrap gap-1.5">
      {OUTCOMES.filter((o) => o.key !== "no_answer").map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={pending}
          title={o.hint}
          onClick={() => start(async () => setResult(await fileCallOutcome({ callId, outcome: o.key })))}
          className="min-h-11 rounded-lg border bg-card px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          {o.label.replace("…", "")}
        </button>
      ))}
      <Result result={result} />
    </div>
  );
}
