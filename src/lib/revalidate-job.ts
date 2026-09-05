import { revalidatePath } from "next/cache";

/**
 * Every screen that reads a job's status, refreshed together.
 *
 * The pipeline, the dashboard and the job stage are all derived rather than
 * stored, which was meant to make drift impossible. It did, for the data.
 * What it did not cover was the cache: an action that changed a job and
 * revalidated only its own page left every other screen serving the answer
 * from before. A client signing their proposal updated the job and the
 * proposals list and left the pipeline card sitting in the old column, which
 * looks exactly like a status that did not save.
 *
 * So the list lives here once and every action that moves a job calls it.
 * Naming the paths at each call site is how one gets forgotten, and the one
 * that gets forgotten is always the one somebody is looking at.
 *
 * Cheap to be generous: revalidatePath only marks a path stale, so listing a
 * screen the change did not affect costs one render nobody was waiting on.
 * Missing one costs a phone call about a bug that is not there.
 */
const DERIVED_FROM_JOB_STATUS = [
  "/pipeline",
  "/dashboard",
  "/proposals",
  "/evaluations",
  "/my-day",
  "/today",
  "/attractors",
  "/contacts",
  // The root is the dashboard for most roles.
  "/",
];

/**
 * Call after anything that changes a job, its proposal, its schedule or its
 * crew. `jobId` adds that job's own page; `customerId` adds the client's.
 */
export function revalidateJobViews(jobId?: string | null, customerId?: string | null): void {
  for (const path of DERIVED_FROM_JOB_STATUS) revalidatePath(path);
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (customerId) revalidatePath(`/clients/${customerId}`);
}

/** The paths, exported so a test can assert the pipeline is among them. */
export const JOB_STATUS_PATHS = DERIVED_FROM_JOB_STATUS;
