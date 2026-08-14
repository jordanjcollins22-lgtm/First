"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { computeJourneyMetrics } from "@/lib/journey-metrics";
import { JourneyTree } from "./journey-tree";
import { JourneyStepDetail } from "./journey-step-detail";
import type { Journey, JourneyStep } from "@/types/domain";

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function JourneyDashboard({
  journeys,
  stepsByJourney,
  codeManagedRoleKeys,
}: {
  journeys: Journey[];
  stepsByJourney: Record<string, JourneyStep[]>;
  codeManagedRoleKeys: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(journeys[0]?.id ?? null);
  const codeManaged = new Set(codeManagedRoleKeys);
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);

  const selected = journeys.find((j) => j.id === selectedId) ?? null;
  const steps = useMemo(() => (selected ? stepsByJourney[selected.id] ?? [] : []), [selected, stepsByJourney]);
  const metrics = useMemo(() => computeJourneyMetrics(steps), [steps]);
  const selectedStep = useMemo(
    () => steps.find((s) => s.step_key === selectedStepKey) ?? null,
    [steps, selectedStepKey]
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {journeys.map((journey) => (
          <button
            key={journey.id}
            type="button"
            onClick={() => {
              setSelectedId(journey.id);
              setSelectedStepKey(null);
            }}
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
      </div>

      {!selected && <p className="text-sm text-muted-foreground">No journeys yet.</p>}

      {selected && (() => {
        const isCodeManaged = codeManaged.has(selected.role_key);
        return (
          <>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                {isCodeManaged && (
                  <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    SYNCED WITH THE APP
                  </span>
                )}
              </div>
              {selected.description && <p className="text-sm text-muted-foreground">{selected.description}</p>}
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
                  journey aren&apos;t built in the app yet.
                </CardContent>
              </Card>
            )}

            {steps.length > 0 ? (
              <JourneyTree steps={steps} selectedKey={selectedStepKey} onSelectStep={setSelectedStepKey} />
            ) : (
              <p className="text-sm text-muted-foreground">No steps recorded for this journey.</p>
            )}

            {selectedStep && (
              <JourneyStepDetail step={selectedStep} allSteps={steps} onGoToStep={setSelectedStepKey} />
            )}
          </>
        );
      })()}
    </div>
  );
}
