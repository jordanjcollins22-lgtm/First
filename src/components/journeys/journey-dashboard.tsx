"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createJourney, deleteJourney } from "@/lib/actions/journey-actions";
import { computeJourneyMetrics } from "@/lib/journey-metrics";
import { JourneyStepCard } from "./journey-step-card";
import { AddJourneyStepForm } from "./add-journey-step-form";
import type { Journey, JourneyStep } from "@/types/domain";

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function AddJourneyForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createJourney(formData);
        formRef.current?.reset();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent"
      >
        + Add journey for a new role
      </button>
    );
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card/60 p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-journey-name">Journey name</Label>
        <Input id="new-journey-name" name="name" required placeholder="e.g. Account Manager Journey" className="w-56" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-journey-role">Role key</Label>
        <Input id="new-journey-role" name="role_key" placeholder="e.g. account_manager" className="w-40" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating..." : "Create journey"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
        Cancel
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  );
}

export function JourneyDashboard({
  journeys,
  stepsByJourney,
}: {
  journeys: Journey[];
  stepsByJourney: Record<string, JourneyStep[]>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(journeys[0]?.id ?? null);
  const [isPending, startTransition] = useTransition();
  const highlightRef = useRef<Record<string, HTMLDivElement | null>>({});

  const selected = journeys.find((j) => j.id === selectedId) ?? null;
  const steps = useMemo(() => (selected ? stepsByJourney[selected.id] ?? [] : []), [selected, stepsByJourney]);
  const metrics = useMemo(() => computeJourneyMetrics(steps), [steps]);

  function handleGoToStep(stepKey: string) {
    const el = highlightRef.current[stepKey];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary");
    setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1200);
  }

  function handleDeleteJourney(id: string) {
    if (!confirm("Delete this journey and all of its steps?")) return;
    startTransition(async () => {
      await deleteJourney(id);
      if (selectedId === id) setSelectedId(journeys.find((j) => j.id !== id)?.id ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {journeys.map((journey) => (
          <button
            key={journey.id}
            type="button"
            onClick={() => setSelectedId(journey.id)}
            className={cn(
              "rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors",
              selected?.id === journey.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card/60 hover:bg-accent"
            )}
          >
            {journey.name}
          </button>
        ))}
        <AddJourneyForm />
      </div>

      {!selected && <p className="text-sm text-muted-foreground">No journeys yet — add one above.</p>}

      {selected && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              {selected.description && <p className="text-sm text-muted-foreground">{selected.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => handleDeleteJourney(selected.id)}
              disabled={isPending}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete journey
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            <MetricTile label="Total steps" value={metrics.totalSteps} />
            <MetricTile label="Total clicks" value={metrics.totalClicks} />
            <MetricTile label="Manual inputs" value={metrics.manualInputs} />
            <MetricTile label="Automated actions" value={metrics.automatedActions} />
            <MetricTile label="Human approvals" value={metrics.humanApprovals} />
            <MetricTile label="Customer comms" value={metrics.customerComms} />
            <MetricTile label="Internal comms" value={metrics.internalComms} />
            <MetricTile label="Texts" value={metrics.texts} />
            <MetricTile label="Emails" value={metrics.emails} />
            <MetricTile label="Calls" value={metrics.calls} />
            <MetricTile
              label="Avg. min between steps"
              value={metrics.avgMinutesBetweenSteps != null ? metrics.avgMinutesBetweenSteps.toFixed(1) : "—"}
            />
            <MetricTile
              label="Total journey time"
              value={metrics.totalMinutes != null ? `${metrics.totalMinutes.toFixed(1)} min` : "—"}
            />
          </div>

          {metrics.notBuiltCount > 0 && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="pt-4 text-sm">
                <span className="font-semibold text-destructive">{metrics.notBuiltCount} step(s)</span> in this
                journey aren&apos;t built in the app yet — flagged below. That&apos;s the backlog this
                dashboard exists to surface.
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            {steps.map((step) => (
              <div key={step.id} ref={(el) => { highlightRef.current[step.step_key] = el; }}>
                <JourneyStepCard step={step} allSteps={steps} onGoToStep={handleGoToStep} />
              </div>
            ))}
            {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet — add one below.</p>}
          </div>

          <AddJourneyStepForm journeyId={selected.id} />
        </>
      )}
    </div>
  );
}
