"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  dismissSalesException,
  mergeServices,
  offerGoodBetterBest,
  recheckProposal,
  saveAutopilotSettings,
  setServiceRate,
  type ActionResult,
} from "@/lib/actions/sales-autopilot-actions";
import { DIVISION_LABEL, DIVISIONS, type Division } from "@/lib/sales/divisions";
import type { DuplicateGroup, ServiceRow } from "@/lib/sales/service-dedupe";

/**
 * The interactive half of the Pipeline autopilot panel: the buttons on a
 * needs-you item, the autopilot's switches and guardrails, and the rate
 * coverage list with inline editing and merges.
 */

function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));
  const message = result ? (result.ok ? result.message ?? "Done." : result.error) : null;
  return { pending, run, message, failed: result ? !result.ok : false };
}

function Said({ message, failed }: { message: string | null; failed: boolean }) {
  if (!message) return null;
  return (
    <p role="status" className={`text-xs ${failed ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
      {message}
    </p>
  );
}

/** Check again / offer options / dismiss, on one needs-you item. */
export function ExceptionButtons({ id, jobId, kind }: { id: string; jobId: string | null; kind: "proposal_overdue" | "price_held" }) {
  const { pending, run, message, failed } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {kind === "price_held" && jobId && (
          <>
            <Button size="sm" className="min-h-11" disabled={pending} onClick={() => run(() => recheckProposal(jobId))}>
              Check again
            </Button>
            <Button size="sm" variant="secondary" className="min-h-11" disabled={pending} onClick={() => run(() => offerGoodBetterBest(jobId))}>
              Offer Good / Better / Best
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" className="min-h-11" disabled={pending} onClick={() => run(() => dismissSalesException(id, "Dealt with by hand."))}>
          Dismiss
        </Button>
      </div>
      <Said message={message} failed={failed} />
    </div>
  );
}

export interface SettingsView {
  ready: boolean;
  autoApprove: boolean;
  autoSend: boolean;
  startedAt: string | null;
  targets: Record<Division, number>;
  tolerance: number;
  speedTargetHours: number;
  overdueExceptions: boolean;
  overdueStartedAt: string | null;
  offerOptions: boolean;
  mhicLicense: string | null;
}

function Toggle({ label, help, checked, onChange, disabled }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-background p-3">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  );
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : null);

/** The autopilot's switches and the guardrails it holds prices to. */
export function AutopilotSettingsForm({ settings }: { settings: SettingsView }) {
  const [autoApprove, setAutoApprove] = useState(settings.autoApprove);
  const [autoSend, setAutoSend] = useState(settings.autoSend);
  const [overdue, setOverdue] = useState(settings.overdueExceptions);
  const [offerOptions, setOfferOptions] = useState(settings.offerOptions);
  const [targets, setTargets] = useState<Record<Division, string>>(
    Object.fromEntries(DIVISIONS.map((d) => [d, String(Math.round(settings.targets[d] * 1000) / 10)])) as Record<Division, string>
  );
  const [tolerance, setTolerance] = useState(String(Math.round(settings.tolerance * 1000) / 10));
  const [hours, setHours] = useState(String(settings.speedTargetHours));
  const [license, setLicense] = useState(settings.mhicLicense ?? "");
  const { pending, run, message, failed } = useAction();

  if (!settings.ready) {
    return <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">The autopilot isn&apos;t set up yet: migration 0361 has to be applied first.</p>;
  }

  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          saveAutopilotSettings({
            autoApprove,
            autoSend,
            targets: Object.fromEntries(DIVISIONS.map((d) => [d, Number(targets[d])])) as Record<Division, number>,
            tolerancePct: Number(tolerance),
            speedTargetHours: Number(hours),
            overdueExceptions: overdue,
            offerOptions,
            mhicLicense: license,
          })
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle
          label="Approve prices inside the guardrails"
          help={settings.startedAt ? `Live since ${day(settings.startedAt)}. Only evaluations submitted after that are touched.` : "Goes live when switched on. Nothing submitted before then is touched."}
          checked={autoApprove}
          onChange={(v) => {
            setAutoApprove(v);
            if (!v) setAutoSend(false);
          }}
        />
        <Toggle
          label="And email them to the client"
          help="Through the same consent, quiet-hours and approval rules as every client message."
          checked={autoSend && autoApprove}
          disabled={!autoApprove}
          onChange={setAutoSend}
        />
        <Toggle
          label="Chase proposals past the speed target"
          help={settings.overdueStartedAt ? `An exception and a text to the evaluator. Live since ${day(settings.overdueStartedAt)}.` : "An exception and a text to the evaluator."}
          checked={overdue}
          onChange={setOverdue}
        />
        <Toggle label="Offer Good / Better / Best" help="On proposals the autopilot sends: the essentials, as priced, and with a weed preventer." checked={offerOptions} onChange={setOfferOptions} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Gross margin each division must leave</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DIVISIONS.map((d) => (
            <label key={d} className="grid gap-1 text-xs">
              {DIVISION_LABEL[d]} %
              <Input inputMode="decimal" className="min-h-11" value={targets[d]} onChange={(e) => setTargets({ ...targets, [d]: e.target.value })} />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-xs">
          Within ± % of the formula
          <Input inputMode="decimal" className="min-h-11" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs">
          Speed target, hours
          <Input inputMode="decimal" className="min-h-11" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label className="col-span-2 grid gap-1 text-xs sm:col-span-1">
          MHIC licence number
          <Input className="min-h-11" value={license} placeholder="For the contract block" onChange={(e) => setLicense(e.target.value)} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" className="min-h-11" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Said message={message} failed={failed} />
      </div>
    </form>
  );
}

function RateRow({ row }: { row: ServiceRow }) {
  const [rate, setRate] = useState(row.cost != null ? String(row.cost) : "");
  const [unit, setUnit] = useState(row.costUnit ?? "flat rate");
  const { pending, run, message, failed } = useAction();
  return (
    <li className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{row.name}</p>
        <p className="text-xs text-muted-foreground">{row.uses ? `Asked for on ${row.uses} booking${row.uses === 1 ? "" : "s"}` : "Not asked for on a booking yet"}</p>
      </div>
      <Input aria-label={`Rate for ${row.name}, dollars`} inputMode="decimal" placeholder="$" className="min-h-11" value={rate} onChange={(e) => setRate(e.target.value)} />
      <Input aria-label={`Unit for ${row.name}`} className="min-h-11" value={unit} onChange={(e) => setUnit(e.target.value)} />
      <div className="flex flex-col gap-1">
        <Button size="sm" className="min-h-11" disabled={pending} onClick={() => run(() => setServiceRate(row.serviceTypeId, rate, unit))}>
          Save
        </Button>
        <Said message={message} failed={failed} />
      </div>
    </li>
  );
}

function MergeGroup({ group }: { group: DuplicateGroup }) {
  const { pending, run, message, failed } = useAction();
  return (
    <li className="grid gap-2 rounded-lg border bg-background p-3">
      <p className="text-sm">
        <span className="font-semibold">{[group.keep, ...group.merge].map((s) => `“${s.name}”`).join(", ")}</span> look like one service.
      </p>
      <p className="text-xs text-muted-foreground">{group.why} Jobs, site maps and options pointing at the others move to it; the others stay on file as merged so old proposals still read.</p>
      <div className="flex flex-wrap gap-2">
        {group.merge.map((m) => (
          <Button
            key={m.serviceTypeId}
            size="sm"
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Merge “${m.name}” into “${group.keep.name}”? Every job and site map using it will use “${group.keep.name}” instead.`)) {
                run(() => mergeServices(m.serviceTypeId, group.keep.serviceTypeId));
              }
            }}
          >
            Merge “{m.name}” into “{group.keep.name}”
          </Button>
        ))}
      </div>
      <Said message={message} failed={failed} />
    </li>
  );
}

/** Every active service with no rate, editable in place, and the duplicates with a safe merge. */
export function RateCoverage({ missing, duplicates }: { missing: ServiceRow[]; duplicates: DuplicateGroup[] }) {
  return (
    <div className="grid gap-4">
      {missing.length === 0 ? (
        <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">Every active service has a rate.</p>
      ) : (
        <ul className="grid gap-2">
          {missing.map((row) => (
            <RateRow key={row.serviceTypeId} row={row} />
          ))}
        </ul>
      )}
      {duplicates.length > 0 && (
        <div className="grid gap-2">
          <h4 className="text-sm font-semibold">Duplicates to merge</h4>
          <ul className="grid gap-2">
            {duplicates.map((g) => (
              <MergeGroup key={g.key} group={g} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
