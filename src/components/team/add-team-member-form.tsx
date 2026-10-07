"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTeamMember } from "@/lib/actions/team-actions";

import { SELECT_CLASS, TIMEZONES } from "./constants";

export function AddTeamMemberForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createTeamMember(formData);
      setError(result.error ?? null);
      if (!result.error) formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required placeholder="Marcus Lee" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Mobile number</Label>
          <Input id="phone" name="phone" type="tel" required placeholder="(555) 123-4567" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">Role</Label>
          <Input id="role" name="role" placeholder="Crew lead" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone">Time zone</Label>
          <select id="timezone" name="timezone" className={SELECT_CLASS} defaultValue="America/New_York">
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="is_manager" />
        Manager: gets texted when someone misses a check-in or reports a delay
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : "Add Team Member"}
      </Button>
    </form>
  );
}
