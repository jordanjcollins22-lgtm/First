"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Play, Square, Timer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cancelServiceTimer, finishServiceTimer, startServiceTimer } from "@/lib/actions/service-timing-actions";
import { clockHours, hoursLabel, type ServiceTimeLog, type TimedService } from "@/lib/service-timing";
import type { JobServiceTimers } from "@/lib/data/service-timing";
import { cn } from "@/lib/utils";

// "sq ft", "cu yd", "1 plant", "3 plants", "2 bushes".
const unitWord = (u: string, n = 2) => (u === "SF" ? "sq ft" : u === "CY" ? "cu yd" : n === 1 ? u : u === "bush" ? "bushes" : `${u}s`);
const amount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Time each service on the job: Start when you begin it, Done when it is
 * finished, then say how much got done and how many of you were on it.
 * Every one is kept with this job, and the production rates are averaged
 * from all of them, so the next price is built on how long the work really
 * takes.
 */
export function ServiceTimers({ jobId, timers }: { jobId: string; timers: JobServiceTimers }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const logFor = (s: TimedService) => {
    const mine = timers.logs.filter((l) => l.zoneId === s.zoneId && l.serviceKey === s.key);
    return mine.find((l) => !l.finishedAt) ?? mine[mine.length - 1] ?? null;
  };
  const run = (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) return setError(result.message ?? "That didn't work. Try again.");
      router.refresh();
    });
  };

  const areas = [...new Map(timers.services.map((s) => [s.zoneId, s.zoneName])).entries()];
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Timer className="h-5 w-5 text-primary" /> Time each service
        </h2>
        <p className="text-sm text-muted-foreground">Tap Start when you begin a service and Done when it&apos;s finished. It shows us how long the work really takes.</p>
      </div>
      {areas.map(([zoneId, zoneName]) => (
        <div key={zoneId} className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{zoneName}</p>
          {timers.services
            .filter((s) => s.zoneId === zoneId)
            .map((s) => (
              <ServiceRow
                key={`${s.zoneId}-${s.key}`}
                service={s}
                log={logFor(s)}
                now={now}
                crewPeople={timers.crewPeople}
                pending={pending}
                onStart={() => run(() => startServiceTimer(jobId, { zoneId: s.zoneId, zoneName: s.zoneName, serviceKey: s.key, plannedQuantity: s.plannedQuantity }))}
                onFinish={(log, quantity, people) => run(() => finishServiceTimer(jobId, log.id, quantity, people))}
                onCancel={(log) => run(() => cancelServiceTimer(jobId, log.id))}
              />
            ))}
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

function ServiceRow({
  service,
  log,
  now,
  crewPeople,
  pending,
  onStart,
  onFinish,
  onCancel,
}: {
  service: TimedService;
  log: ServiceTimeLog | null;
  now: number;
  crewPeople: number;
  pending: boolean;
  onStart: () => void;
  onFinish: (log: ServiceTimeLog, quantity: number, people: number) => void;
  onCancel: (log: ServiceTimeLog) => void;
}) {
  const [stopping, setStopping] = useState(false);
  const [quantity, setQuantity] = useState(String(service.plannedQuantity || ""));
  const [people, setPeople] = useState(String(crewPeople));
  const running = log && !log.finishedAt ? log : null;
  const finished = log && log.finishedAt ? log : null;
  const elapsed = running ? (now - new Date(running.startedAt).getTime()) / 3_600_000 : 0;

  return (
    <div className={cn("rounded-xl border p-3", running ? "border-primary bg-primary/5" : "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{service.label}</p>
          <p className="text-xs text-muted-foreground">
            {finished
              ? `Done: ${amount(finished.quantity ?? 0)} ${unitWord(service.unit, finished.quantity ?? 0)} in ${hoursLabel(clockHours(finished) ?? 0)}, ${finished.people} on it`
              : running
                ? `Started ${new Date(running.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${running.by ? ` by ${running.by}` : ""} · ${hoursLabel(elapsed)} so far`
                : service.plannedQuantity > 0
                  ? `${amount(service.plannedQuantity)} ${unitWord(service.unit, service.plannedQuantity)} on the proposal`
                  : "Not started"}
          </p>
        </div>
        {finished ? (
          <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-700">
            <Check className="h-4 w-4" /> Done
          </span>
        ) : running ? (
          !stopping && (
            <Button type="button" className="h-11 shrink-0 px-4" disabled={pending} onClick={() => setStopping(true)}>
              <Square className="mr-1.5 h-4 w-4" /> Done
            </Button>
          )
        ) : (
          <Button type="button" variant="outline" className="h-11 shrink-0 px-4" disabled={pending} onClick={onStart}>
            {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />} Start
          </Button>
        )}
      </div>

      {running && stopping && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">How much got done?</span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-right text-base tabular-nums"
                  aria-label={`How much ${service.label.toLowerCase()} got done`}
                />
                <span className="shrink-0 text-xs text-muted-foreground">{unitWord(service.unit)}</span>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">People on it</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                step={1}
                value={people}
                onChange={(e) => setPeople(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-2 text-right text-base tabular-nums"
                aria-label="People on it"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button type="button" className="h-11 flex-1 font-semibold" disabled={pending} onClick={() => onFinish(running, Number(quantity), Number(people))}>
              {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Save
            </Button>
            <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => setStopping(false)}>
              Keep going
            </Button>
          </div>
          <button type="button" className="self-start text-xs text-muted-foreground underline" disabled={pending} onClick={() => onCancel(running)}>
            <X className="mr-0.5 inline h-3 w-3" />
            Started by mistake: cancel this timer
          </button>
        </div>
      )}
    </div>
  );
}
