"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import {
  acknowledgeCheckinAlert,
  approveBonusWeek,
  closeOneSession,
  closePastSessions,
  dismissHeldPlacement,
  recomputeJobCost,
  saveAutopilotSettings,
  type OpsResult,
} from "@/lib/actions/ops-autopilot-actions";
import type { AutopilotSettings } from "@/lib/ops/autopilot-settings";
import type { NeedsYou } from "@/lib/data/ops-panels";
import type { BacklogSession } from "@/lib/data/ops-sessions";

/** The interactive parts of the operations panels. Every button is a server action that re-checks the caller. */

function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<OpsResult | null>(null);
  const run = (fn: () => Promise<OpsResult>) => start(async () => setResult(await fn()));
  return { pending, result, run };
}

function Said({ result }: { result: OpsResult | null }) {
  if (!result) return null;
  return <p className={`text-sm ${result.ok ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>{result.message}</p>;
}

const button = "min-h-11 rounded-lg border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50";

export function NeedsYouStrip({ items }: { items: NeedsYou[] }) {
  if (items.length === 0) {
    return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Nothing needs you. Work days are closing themselves.</p>;
  }
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <NeedsYouItem key={item.key} item={item} />
      ))}
    </ul>
  );
}

function NeedsYouItem({ item }: { item: NeedsYou }) {
  const { pending, result, run } = useAction();
  if (result?.ok) return null;
  return (
    <li className="grid gap-2 rounded-xl border border-orange-300 bg-card p-3 dark:border-orange-800">
      <div>
        <p className="font-semibold">{item.title}</p>
        <p className="text-sm text-muted-foreground">{item.detail}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {item.kind === "unclosed" && item.sessionId && (
          <>
            <button type="button" className={button} disabled={pending} onClick={() => run(() => closeOneSession(item.sessionId!, "done"))}>
              Close as done
            </button>
            <button type="button" className={button} disabled={pending} onClick={() => run(() => closeOneSession(item.sessionId!, "cancelled"))}>
              Not worked
            </button>
          </>
        )}
        {item.kind === "checkin" && item.alertId && (
          <button type="button" className={button} disabled={pending} onClick={() => run(() => acknowledgeCheckinAlert(item.alertId!))}>
            I&apos;m on it
          </button>
        )}
        {item.kind === "placement" && item.jobId && (
          <button type="button" className={button} disabled={pending} onClick={() => run(() => dismissHeldPlacement(item.jobId!))}>
            I&apos;ll book it
          </button>
        )}
        {item.jobId && (
          <Link href={`/jobs/${item.jobId}`} className={`${button} inline-flex items-center`}>
            Open job
          </Link>
        )}
      </div>
      <Said result={result} />
    </li>
  );
}

/**
 * The one-click review of past days. Each day is pre-ticked when the record
 * says the work happened (a finish tap, or the job is completed); the person
 * looks, untick anything wrong, and closes the lot.
 */
export function BacklogReview({ sessions }: { sessions: BacklogSession[] }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sessions.filter((s) => s.finishedTap || s.jobCompleted).map((s) => s.id)));
  const { pending, result, run } = useAction();
  if (sessions.length === 0) return null;
  if (result?.ok) return <Said result={result} />;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const unpicked = sessions.filter((s) => !picked.has(s.id)).map((s) => s.id);
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-bold">Review and close past days ({sessions.length})</h3>
        <p className="text-sm text-muted-foreground">
          These ended before auto-close went live, so nothing closed them. Ticked days close as done; the rest can be closed as not worked.
        </p>
      </div>
      <ul className="grid gap-1.5">
        {sessions.map((s) => (
          <li key={s.id}>
            <label className="flex min-h-11 items-center gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{s.address || s.jobName}</span>
                <span className="block text-muted-foreground">
                  {s.startsOn === s.endsOn ? s.startsOn : `${s.startsOn} to ${s.endsOn}`} ·{" "}
                  {s.finishedTap ? "crew tapped finished" : s.jobCompleted ? "job is completed" : "no record of the work"}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={pending || picked.size === 0} onClick={() => run(() => closePastSessions([...picked], "done"))}>
          Close {picked.size} as done
        </button>
        <button type="button" className={button} disabled={pending || unpicked.length === 0} onClick={() => run(() => closePastSessions(unpicked, "cancelled"))}>
          Close {unpicked.length} as not worked
        </button>
      </div>
      <Said result={result} />
    </section>
  );
}

type Field = { key: string; label: string; kind: "boolean" } | { key: string; label: string; kind: "number"; suffix: string; scale?: number };

const FIELDS: { title: string; fields: Field[] }[] = [
  {
    title: "Work days",
    fields: [
      { key: "auto_close_enabled", label: "Close a work day on the crew's \"Finished here\"", kind: "boolean" },
      { key: "unclosed_cutoff_minutes", label: "Still open at (hour, 24h clock) goes to the project lead", kind: "number", suffix: ":00", scale: 60 },
    ],
  },
  {
    title: "Completion chain",
    fields: [
      { key: "completion_chain_enabled", label: "Sign-off request, invoice and cost snapshot when work finishes", kind: "boolean" },
      { key: "invoice_after_client_approval", label: "Invoice only after the client approves the before & afters", kind: "boolean" },
      { key: "signoff_overdue_hours", label: "Client hasn't signed off after", kind: "number", suffix: "hours" },
      { key: "over_budget_pct", label: "Flag a job over its hours by more than", kind: "number", suffix: "%" },
      { key: "labor_burden_pct", label: "Payroll tax and insurance on top of wages", kind: "number", suffix: "%" },
    ],
  },
  {
    title: "Crew check-in",
    fields: [
      { key: "checkin_lead_first_enabled", label: "Text the project lead first, the owner only if they don't answer", kind: "boolean" },
      { key: "checkin_escalate_minutes", label: "Owner hears after", kind: "number", suffix: "minutes" },
    ],
  },
  {
    title: "Auto-placement",
    fields: [
      { key: "auto_place_enabled", label: "Put ready jobs on the calendar and tell the client", kind: "boolean" },
      { key: "auto_place_min_notice_days", label: "Never sooner than", kind: "number", suffix: "days out" },
      { key: "auto_place_daily_cap", label: "At most", kind: "number", suffix: "jobs a day" },
    ],
  },
  {
    title: "Crew bonus",
    fields: [
      { key: "crew_bonus_enabled", label: "Weekly bonus when a crew member's jobs come in under budget", kind: "boolean" },
      { key: "crew_bonus_per_member_cents", label: "Per crew member, per week ($)", kind: "number", suffix: "$", scale: 100 },
    ],
  },
];

const SNAKE: Record<string, keyof AutopilotSettings> = {
  auto_close_enabled: "autoCloseEnabled",
  unclosed_cutoff_minutes: "unclosedCutoffMinutes",
  completion_chain_enabled: "completionChainEnabled",
  invoice_after_client_approval: "invoiceAfterClientApproval",
  signoff_overdue_hours: "signoffOverdueHours",
  over_budget_pct: "overBudgetPct",
  labor_burden_pct: "laborBurdenPct",
  checkin_lead_first_enabled: "checkinLeadFirstEnabled",
  checkin_escalate_minutes: "checkinEscalateMinutes",
  auto_place_enabled: "autoPlaceEnabled",
  auto_place_min_notice_days: "autoPlaceMinNoticeDays",
  auto_place_daily_cap: "autoPlaceDailyCap",
  crew_bonus_enabled: "crewBonusEnabled",
  crew_bonus_per_member_cents: "crewBonusPerMemberCents",
};

export function AutopilotSettingsForm({ settings, sections }: { settings: AutopilotSettings; sections?: string[] }) {
  const { pending, result, run } = useAction();
  const [draft, setDraft] = useState<Record<string, boolean | number>>(() => {
    const out: Record<string, boolean | number> = {};
    for (const [snake, camel] of Object.entries(SNAKE)) out[snake] = settings[camel] as boolean | number;
    return out;
  });
  const shown = FIELDS.filter((g) => !sections || sections.includes(g.title));
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const keys = shown.flatMap((g) => g.fields.map((f) => f.key));
        run(() => saveAutopilotSettings(Object.fromEntries(keys.map((k) => [k, draft[k]]))));
      }}
    >
      {shown.map((group) => (
        <fieldset key={group.title} className="grid gap-2 rounded-xl border bg-card p-4">
          <legend className="px-1 font-bold">{group.title}</legend>
          {group.fields.map((f) =>
            f.kind === "boolean" ? (
              <label key={f.key} className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={Boolean(draft[f.key])} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} />
                <span>{f.label}</span>
              </label>
            ) : (
              <label key={f.key} className="flex min-h-11 flex-wrap items-center gap-3 text-sm">
                <span className="flex-1">{f.label}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  className="min-h-11 w-24 rounded-lg border bg-background px-2"
                  value={Number(draft[f.key]) / (f.scale ?? 1)}
                  onChange={(e) => setDraft({ ...draft, [f.key]: Math.round(Number(e.target.value) * (f.scale ?? 1)) })}
                />
                <span className="text-muted-foreground">{f.suffix}</span>
              </label>
            )
          )}
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        <button type="submit" className={button} disabled={pending}>
          Save settings
        </button>
        <Said result={result} />
      </div>
    </form>
  );
}

export function RecomputeButton({ jobId }: { jobId: string }) {
  const { pending, result, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={button} disabled={pending} onClick={() => run(() => recomputeJobCost(jobId))}>
        Recalculate
      </button>
      <Said result={result} />
    </span>
  );
}

export function ApproveBonusButton({ weekStart, label }: { weekStart: string; label: string }) {
  const { pending, result, run } = useAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={pending} onClick={() => run(() => approveBonusWeek(weekStart))}>
        {label}
      </button>
      <Said result={result} />
    </span>
  );
}
