/**
 * One pass of the backbone: deliver what is due to each consumer, then the
 * sweeps that time alone sets off (follow-ups whose day has come, estimates
 * past their deadline, jobs still held by a check).
 *
 * Safe to run twice at once: deliveries are claimed with a lease, every
 * handler is idempotent, and a worker that dies mid-batch gives its rows back
 * when the lease runs out. A delivery that keeps failing backs off (1, 4, 16,
 * 64 minutes) and then goes dead, where it shows on the attention list
 * instead of retrying forever.
 */

import type { Consumer } from "@/lib/os/contracts";
import { escalateLateEstimates, handleFollowUps, handleWorkflow, recheckHeldJobs, runDueFollowUps, type Deps } from "@/lib/os/handlers";
import { retryDelayMs } from "@/lib/os/rules";

const HANDLERS: Record<Consumer, typeof handleWorkflow> = {
  workflow: handleWorkflow,
  followups: handleFollowUps,
};

/** How long a paused business's deliveries wait before being looked at again. */
const PAUSED_RETRY_MS = 15 * 60_000;

export interface WorkerResult {
  delivered: number;
  retried: number;
  dead: number;
  deferred: number;
  followUps: { proposed: number; skipped: number; failed: number };
  escalated: number;
  rechecked: number;
}

export async function runWorker(deps: Deps, opts: { batch?: number; leaseSeconds?: number } = {}): Promise<WorkerResult> {
  const result: WorkerResult = { delivered: 0, retried: 0, dead: 0, deferred: 0, followUps: { proposed: 0, skipped: 0, failed: 0 }, escalated: 0, rechecked: 0 };

  for (const consumer of Object.keys(HANDLERS) as Consumer[]) {
    const claimed = await deps.store.claim(consumer, opts.batch ?? 50, opts.leaseSeconds ?? 120);
    for (const delivery of claimed) {
      const now = deps.now();
      try {
        const controls = await deps.store.controls(delivery.organizationId);
        if (controls.paused) {
          await deps.store.finishDelivery(delivery.id, { status: "deferred", nextAttemptAt: new Date(now.getTime() + PAUSED_RETRY_MS).toISOString() });
          result.deferred += 1;
          continue;
        }
        const event = await deps.store.getEvent(delivery.eventId);
        if (!event) throw new Error(`Event ${delivery.eventId} not found.`);
        await HANDLERS[consumer](deps, event);
        await deps.store.finishDelivery(delivery.id, { status: "done" });
        result.delivered += 1;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (delivery.attempts >= delivery.maxAttempts) {
          await deps.store.finishDelivery(delivery.id, { status: "dead", error });
          result.dead += 1;
        } else {
          await deps.store.finishDelivery(delivery.id, {
            status: "failed",
            error,
            nextAttemptAt: new Date(now.getTime() + retryDelayMs(delivery.attempts)).toISOString(),
          });
          result.retried += 1;
        }
      }
    }
  }

  result.followUps = await runDueFollowUps(deps);
  result.escalated = await escalateLateEstimates(deps);
  result.rechecked = await recheckHeldJobs(deps);
  return result;
}
