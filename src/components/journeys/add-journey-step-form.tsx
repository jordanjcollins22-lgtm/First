"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createJourneyStep } from "@/lib/actions/journey-actions";

export function AddJourneyStepForm({ journeyId }: { journeyId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [stepType, setStepType] = useState("human");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("step_type", stepType);
    startTransition(async () => {
      try {
        await createJourneyStep(journeyId, formData);
        formRef.current?.reset();
        setStepType("human");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-step-label">Step name</Label>
        <Input id="new-step-label" name="label" required placeholder="e.g. Confirm Deposit" className="w-48" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-step-type">Type</Label>
        <Select value={stepType} onValueChange={setStepType}>
          <SelectTrigger id="new-step-type" className="h-10 w-40">
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-step-role">Role</Label>
        <Input id="new-step-role" name="role_label" placeholder="e.g. Evaluator" className="w-36" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Adding..." : "+ Add step"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
