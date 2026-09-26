"use client";

import { EvaluatorPicker } from "@/components/jobs/evaluator-picker";
import { evaluatorOptions } from "@/lib/affiliate-roles";
import type { Profile } from "@/types/domain";

/**
 * Who a job is assigned to, on the client panel.
 *
 * The same picker as the job page and the evaluations list, so a change made
 * here is checked for double-booking, moves the calendar entry and tells both
 * people. It used to write the column directly and swallow any refusal, so a
 * change that could not be made looked as though it had been.
 */
export function AssignJobSelect({
  jobId,
  initialAssignedTo,
  profiles,
}: {
  jobId: string;
  initialAssignedTo: string | null;
  profiles: Profile[];
}) {
  return (
    <EvaluatorPicker
      jobId={jobId}
      assignedTo={initialAssignedTo}
      options={evaluatorOptions(profiles, initialAssignedTo)}
      canChange
      compact
    />
  );
}
