"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCheckInSchedule } from "@/lib/actions/team-actions";

import { DAY_LABELS, SELECT_CLASS } from "./constants";

const DEFAULT_MESSAGE = "Hey {name}, checking in on {job}. Are you on schedule? Anything slowing you down?";

export function AddScheduleForm({
  teamMemberId,
  jobs,
  onDone,
}: {
  teamMemberId: string;
  jobs: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleDay(day: number) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function handleSubmit(formData: FormData) {
    formData.set("team_member_id", teamMemberId);
    days.forEach((d) => formData.append("days_of_week", String(d)));
    startTransition(async () => {
      const result = await createCheckInSchedule(formData);
      setError(result.error ?? null);
      if (!result.error) onDone();
    });
  }

  const id = (field: string) => `${field}-${teamMemberId}`;

  return (
    <form action={handleSubmit} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("label")}>Label</Label>
          <Input id={id("label")} name="label" placeholder="Morning start" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("time")}>Time</Label>
          <Input id={id("time")} name="time_of_day" type="time" required defaultValue="08:00" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("window")}>Reply within (min)</Label>
          <Input
            id={id("window")}
            name="response_window_minutes"
            type="number"
            min={5}
            defaultValue={30}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Days</Label>
        <div className="flex flex-wrap gap-3">
          {DAY_LABELS.map((label, day) => (
            <label key={label} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={days.includes(day)} onCheckedChange={() => toggleDay(day)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("job")}>Job (optional)</Label>
        <select id={id("job")} name="job_id" className={SELECT_CLASS} defaultValue="">
          <option value="">No specific job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("message")}>Text message</Label>
        <Textarea id={id("message")} name="message" rows={2} defaultValue={DEFAULT_MESSAGE} />
        <p className="text-xs text-muted-foreground">
          {"{name}"} becomes their first name. {"{job}"} becomes the job name.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving..." : "Save Check-in"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
