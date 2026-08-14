"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { updateJourneyStep, deleteJourneyStep } from "@/lib/actions/journey-actions";
import { STEP_TYPE_LABELS, STEP_TYPE_STYLES } from "@/lib/journey-metrics";
import type { JourneyStep, JourneyStepType } from "@/types/domain";

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(value.toString());
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={0}
        step="1"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(Number(draft) || 0)}
        className="h-8 w-20 text-sm"
      />
    </div>
  );
}

export function JourneyStepCard({
  step,
  allSteps,
  onGoToStep,
}: {
  step: JourneyStep;
  allSteps: JourneyStep[];
  onGoToStep: (stepKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(step.notes ?? "");

  function save(patch: Parameters<typeof updateJourneyStep>[1]) {
    startTransition(() => updateJourneyStep(step.id, patch));
  }

  function handleDelete() {
    if (!confirm(`Remove the "${step.label}" step?`)) return;
    startTransition(() => deleteJourneyStep(step.id));
  }

  const labelByKey = new Map(allSteps.map((s) => [s.step_key, s.label]));
  const dependents = allSteps.filter((s) => s.next_steps.includes(step.step_key));

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        step.is_built ? "border-border bg-card/60" : "border-destructive/40 bg-destructive/5"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex flex-1 items-start gap-2 text-left">
          {open ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{step.label}</span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide",
                  STEP_TYPE_STYLES[step.step_type]
                )}
              >
                {STEP_TYPE_LABELS[step.step_type]}
              </span>
              {step.role_label && <span className="text-xs text-muted-foreground">{step.role_label}</span>}
              {!step.is_built && (
                <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                  NOT BUILT YET
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {step.clicks} click{step.clicks === 1 ? "" : "s"}
              {step.manual_inputs > 0 && ` · ${step.manual_inputs} manual input${step.manual_inputs === 1 ? "" : "s"}`}
              {step.est_minutes != null && ` · ~${step.est_minutes} min`}
              {(step.customer_comms > 0 || step.internal_comms > 0) &&
                ` · ${step.customer_comms + step.internal_comms} communication${
                  step.customer_comms + step.internal_comms === 1 ? "" : "s"
                }`}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${step.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3 text-sm">
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

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-2.5">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select
                value={step.step_type}
                onValueChange={(v) => save({ stepType: v as JourneyStepType })}
              >
                <SelectTrigger className="h-8 w-40 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="human">Human</SelectItem>
                  <SelectItem value="automated">Automated</SelectItem>
                  <SelectItem value="human_approval">Human Approval</SelectItem>
                  <SelectItem value="customer_action">Customer Action</SelectItem>
                  <SelectItem value="system_action">System Action</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumberField label="Clicks" value={step.clicks} onCommit={(clicks) => save({ clicks })} />
            <NumberField
              label="Manual inputs"
              value={step.manual_inputs}
              onCommit={(manualInputs) => save({ manualInputs })}
            />
            <NumberField
              label="Customer comms"
              value={step.customer_comms}
              onCommit={(customerComms) => save({ customerComms })}
            />
            <NumberField
              label="Internal comms"
              value={step.internal_comms}
              onCommit={(internalComms) => save({ internalComms })}
            />
            <NumberField label="Texts" value={step.texts} onCommit={(texts) => save({ texts })} />
            <NumberField label="Emails" value={step.emails} onCommit={(emails) => save({ emails })} />
            <NumberField label="Calls" value={step.calls} onCommit={(calls) => save({ calls })} />
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Est. minutes</Label>
              <Input
                type="number"
                min={0}
                step="0.1"
                defaultValue={step.est_minutes ?? ""}
                onBlur={(e) => save({ estMinutes: e.target.value ? Number(e.target.value) : null })}
                className="h-8 w-24 text-sm"
              />
            </div>
            <label className="flex items-center gap-1.5 pb-1.5 text-xs">
              <input
                type="checkbox"
                checked={step.is_built}
                onChange={(e) => save({ isBuilt: e.target.checked })}
                className="h-4 w-4"
              />
              Built today
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Inputs (comma-separated)</Label>
              <Input
                defaultValue={step.inputs.join(", ")}
                onBlur={(e) => save({ inputs: splitList(e.target.value) })}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Outputs (comma-separated)</Label>
              <Input
                defaultValue={step.outputs.join(", ")}
                onBlur={(e) => save({ outputs: splitList(e.target.value) })}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Automations (comma-separated)</Label>
              <Input
                defaultValue={step.automations.join(", ")}
                onBlur={(e) => save({ automations: splitList(e.target.value) })}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                Next step keys (comma-separated — use another step&apos;s key)
              </Label>
              <Input
                defaultValue={step.next_steps.join(", ")}
                onBlur={(e) => save({ nextSteps: splitList(e.target.value) })}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => save({ notes: notes.trim() || null })}
              className="min-h-16 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
