"use client";

import { cn } from "@/lib/utils";
import { STEP_TYPE_LABELS, STEP_TYPE_STYLES } from "@/lib/journey-metrics";
import type { JourneyStep } from "@/types/domain";

/** Read-only panel for whichever step is selected in the tree — the dashboard only ever displays what's already there. */
export function JourneyStepDetail({ step, allSteps, onGoToStep }: { step: JourneyStep; allSteps: JourneyStep[]; onGoToStep: (stepKey: string) => void }) {
  const labelByKey = new Map(allSteps.map((s) => [s.step_key, s.label]));
  const dependents = allSteps.filter((s) => s.next_steps.includes(step.step_key));

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card/60 p-4 text-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{step.label}</span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide",
              STEP_TYPE_STYLES[step.step_type]
            )}
          >
            {STEP_TYPE_LABELS[step.step_type]}
          </span>
          {step.role_label && <span className="text-xs text-muted-foreground">{step.role_label}</span>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {step.clicks} click{step.clicks === 1 ? "" : "s"}
          {step.manual_inputs > 0 && ` · ${step.manual_inputs} manual input${step.manual_inputs === 1 ? "" : "s"}`}
          {step.est_minutes != null && ` · ~${step.est_minutes} min`}
          {(step.customer_comms > 0 || step.internal_comms > 0) &&
            ` · ${step.customer_comms + step.internal_comms} communication${
              step.customer_comms + step.internal_comms === 1 ? "" : "s"
            }`}
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Inputs required</p>
          <p>{step.inputs.length > 0 ? step.inputs.join(", ") : "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Outputs created</p>
          <p>{step.outputs.length > 0 ? step.outputs.join(", ") : "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Automations triggered</p>
          <p>{step.automations.length > 0 ? step.automations.join(", ") : "—"}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Depends on</p>
          <p>
            {dependents.length > 0
              ? dependents.map((d) => d.label).join(", ")
              : "Nothing points here yet — an entry point"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Next possible steps</p>
          {step.next_steps.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {step.next_steps.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onGoToStep(key)}
                  className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-accent"
                >
                  {labelByKey.get(key) ?? key}
                </button>
              ))}
            </div>
          ) : (
            <p>Terminal — nothing after this</p>
          )}
        </div>
      </div>

      {step.notes && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Notes</p>
          <p className="whitespace-pre-wrap">{step.notes}</p>
        </div>
      )}
    </div>
  );
}
