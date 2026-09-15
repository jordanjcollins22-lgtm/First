"use client";

import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignJob } from "@/lib/actions/job-actions";
import type { Profile } from "@/types/domain";

const UNASSIGNED = "unassigned";

export function AssignJobSelect({
  jobId,
  initialAssignedTo,
  profiles,
}: {
  jobId: string;
  initialAssignedTo: string | null;
  profiles: Profile[];
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      try {
        await assignJob(jobId, value === UNASSIGNED ? null : value);
      } catch {
        // Best-effort — e.g. the "assigned_to" column migration hasn't run yet.
      }
    });
  }

  return (
    <Select defaultValue={initialAssignedTo ?? UNASSIGNED} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="h-8 w-40 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.full_name || profile.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
