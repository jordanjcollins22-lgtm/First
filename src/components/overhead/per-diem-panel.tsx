"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { money } from "@/lib/inventory-value";
import { daysForJob, flatOverheadFor, overheadForJob } from "@/lib/per-diem";
import { setOverheadBasis, setWorkingPattern } from "@/lib/actions/per-diem-actions";
import type { PerDiemBoard } from "@/lib/data/per-diem";

/**
 * What a day of work has to earn before the business has made anything.
 *
 * Quotes carried a flat ten percent for overhead. It was a guess, it was never
 * checked against anything, and it was the same ten percent whether a job took
 * an afternoon or a fortnight -- which is backwards. Overhead is a cost of
 * time passing: two weeks of work ties up two weeks of rent, insurance and
 * software whatever its materials cost. Being a percentage of cost, it also
 * collected most on the jobs with expensive materials and least on the long
 * labour-heavy ones, which are exactly the jobs that tie the business up.
 *
 * The real number is known now, off the bank. This turns it into what one
 * crew-day and one crew-hour have to carry, and shows the old rule beside it
 * on two jobs -- because "switch to a per diem" is not an argument, and "the
 * old rule charges this job $28 and the day actually costs $253" is.
 */
export function PerDiemPanel({ board }: { board: PerDiemBoard }) {
  const { perDiem, pattern, lines } = board;

  if (perDiem.perMonth <= 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        There is no overhead worked out yet, so there is nothing to spread across a day. Once the
        banks have sent a few months it works itself out.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 divide-x divide-border rounded-lg border border-border">
        <Figure label="A day on site" value={money(perDiem.perDay)} />
        <Figure label="A crew-hour" value={money(perDiem.perCrewHour)} />
      </div>

      <p className="text-xs text-muted-foreground">
        {money(perDiem.perMonth)} a month spread across {pattern.billableDaysPerMonth} billable days.
        A full crew for a full day comes to exactly one day&apos;s overhead: the rent does not care
        how many people are in the van.
      </p>

      <Basis board={board} />

      <section className="rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-sm font-semibold">What makes up a day</h3>
        </div>
        <ul className="divide-y divide-border">
          {lines.map((line) => (
            <li key={line.label} className="flex items-baseline justify-between gap-2 px-3 py-2">
              <span className="text-sm">{line.label}</span>
              <span className="text-xs text-muted-foreground">
                {Math.round(line.share * 100)}%
              </span>
              <span className="ml-auto text-sm font-semibold tabular-nums">
                {money(line.perDay)}/day
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Comparison board={board} />

      <Pattern board={board} />
    </div>
  );
}

/** Which way quotes charge it, and what that does to them. */
function Basis({ board }: { board: PerDiemBoard }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(basis: "percent" | "per_diem") {
    start(async () => {
      const result = await setOverheadBasis({ basis });
      setError(result.ok ? null : result.error);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-border px-3 py-2">
      <p className="text-sm font-semibold">What quotes charge</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => choose("per_diem")}
          className={cn(
            "min-h-9 rounded-md border px-3 text-xs",
            board.basis === "per_diem"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-accent"
          )}
        >
          {money(board.perDiem.perCrewHour)} a crew-hour
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => choose("percent")}
          className={cn(
            "min-h-9 rounded-md border px-3 text-xs",
            board.basis === "percent"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-accent"
          )}
        >
          {board.overheadPercent}% of the marked-up cost
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        This changes every price the business quotes. The margin multiplier of{" "}
        {board.multiplier}× is untouched either way.
      </p>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </section>
  );
}

/**
 * The old rule and the new one, on two jobs that show where they disagree.
 *
 * Not chosen to flatter the per diem. They are the two shapes of job this
 * business actually quotes, and the percentage is wrong in opposite directions
 * on each.
 */
function Comparison({ board }: { board: PerDiemBoard }) {
  const long = { hours: 64, materials: 80, labour: 25 * 64, name: "Four days, two people, $80 of mulch" };
  const short = { hours: 8, materials: 4_000, labour: 25 * 8, name: "Half a day, $4,000 of pavers" };

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">What the two rules collect</h3>
        <p className="text-xs text-muted-foreground">
          The percentage is charged on cost, so it collects most where the materials are expensive
          and least where the time is long. The jobs it under-charges are the ones that tie the
          business up for a fortnight.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {[long, short].map((job) => {
          const direct = job.materials + job.labour;
          const flat = flatOverheadFor(direct, board.multiplier, board.overheadPercent);
          const real = overheadForJob(job.hours, board.perDiem);
          return (
            <li key={job.name} className="px-3 py-2">
              <p className="text-sm font-medium">{job.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {daysForJob(job.hours, board.pattern)} days on site · {money(direct)} of direct cost
              </p>
              <div className="mt-1 flex gap-4 text-xs">
                <span>
                  Flat {board.overheadPercent}%: <span className="font-semibold tabular-nums">{money(flat)}</span>
                </span>
                <span>
                  Per diem: <span className="font-semibold tabular-nums">{money(real)}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The three assumptions, out loud and editable.
 *
 * A per diem is only as honest as the days you admit to losing. Counting all
 * twenty-two working days under-recovers every time it rains, because the rent
 * was still due on the days nobody could work.
 */
function Pattern({ board }: { board: PerDiemBoard }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [days, setDays] = useState(String(board.pattern.billableDaysPerMonth));
  const [hours, setHours] = useState(String(board.pattern.hoursPerDay));
  const [crew, setCrew] = useState(String(board.pattern.crewSize));
  const [error, setError] = useState<string | null>(null);

  function submit() {
    start(async () => {
      const result = await setWorkingPattern({
        billableDaysPerMonth: Number(days),
        hoursPerDay: Number(hours),
        crewSize: Number(crew),
      });
      setError(result.ok ? null : result.error);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-border px-3 py-3">
      <p className="text-sm font-semibold">What a working month looks like</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Billable days, not working days. Rain, quoting, breakdowns, loading and the drive are real
        and are not on anybody&apos;s invoice.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Field label="Billable days" value={days} onChange={setDays} />
        <Field label="Hours a day" value={hours} onChange={setHours} />
        <Field label="Crew size" value={crew} onChange={setCrew} />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="mt-2 min-h-9 rounded-md border border-border px-3 text-xs hover:bg-accent"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
      />
    </label>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
