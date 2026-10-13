/**
 * The evaluator's home screen in the new layout: the rules behind it, kept
 * pure so they are tested without a database.
 */

import type { V2Role } from "@/lib/data/v2";

/** Where the evaluator's own day lives in the new layout. */
export const EVALUATOR_HOME = "/v2/sales";

/**
 * Where the visit flow sends somebody back to. An evaluator (and anybody
 * else who isn't the owner) goes back to their day in the new layout; the
 * owner keeps the old visits list, which is the only place that shows
 * everybody's.
 */
export function visitBackHref(roles: readonly V2Role[]): string {
  return roles.includes("evaluator") && !roles.includes("owner") ? EVALUATOR_HOME : "/evaluate";
}

/** The words on the way back, matched to where it goes. */
export function backLabel(href: string): string {
  if (href.startsWith("/v2")) return "Back to my day";
  if (href.startsWith("/evaluate/")) return "Back to the visit";
  return "Your evaluations";
}

/**
 * A "back" address handed to the directions screen, checked: only the new
 * layout's pages and a visit, never somewhere off the app.
 */
export function safeBack(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^\/(v2\/[a-z-]+|evaluate\/[\w-]+)$/.test(raw) ? raw : null;
}

export type OutcomeTone = "sent" | "waiting" | "held" | "won" | "lost";

export interface ProposalFacts {
  /** The proposal's status, or null when none has been drawn up yet. */
  status: string | null;
  sentAt: string | null;
  /** The newest price check, when there is one. */
  check: { action: string; reasons: string[] } | null;
}

export interface Outcome {
  tone: OutcomeTone;
  label: string;
  /** Why it is where it is, in plain words, when that is not obvious. */
  why: string | null;
}

/**
 * What became of the proposal after the evaluator pressed Submit: priced and
 * sent, waiting, or held and why. Said the way the evaluator would say it.
 */
export function proposalOutcome(f: ProposalFacts): Outcome {
  switch (f.status) {
    case null:
      return { tone: "waiting", label: "Being priced", why: "The proposal is being drawn up from your site map." };
    case "accepted":
      return { tone: "won", label: "Signed by the client", why: null };
    case "declined":
      return { tone: "lost", label: "Turned down by the client", why: null };
    case "sent":
      return f.sentAt
        ? { tone: "sent", label: "Priced and sent to the client", why: null }
        : { tone: "sent", label: "Priced and approved", why: "The email to the client goes out shortly." };
    case "needs_approval": {
      if (f.check?.action === "hold") {
        const reasons = f.check.reasons.filter(Boolean);
        return {
          tone: "held",
          label: "Held for the office to check the price",
          why: reasons.length ? reasons.join(" ") : "The price was outside the usual range.",
        };
      }
      return { tone: "waiting", label: "Priced, waiting for the office", why: "Nothing needed from you." };
    }
    default:
      return { tone: "waiting", label: "With the office", why: null };
  }
}

/** The newest check per job, from rows in any order. */
export function latestChecks<T extends { job_id: string; checked_at: string }>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const have = out.get(r.job_id);
    if (!have || r.checked_at > have.checked_at) out.set(r.job_id, r);
  }
  return out;
}

/** A guardrail check's reasons, as stored (a JSON array of strings). */
export function readReasons(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === "string") : [];
}
