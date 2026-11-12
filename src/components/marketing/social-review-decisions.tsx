"use client";

import { createContext, useContext, useState } from "react";

import { countDecisions, decide, type Decisions, type Verdict } from "@/lib/social/review-decision";

/**
 * Approve and Deny on the preview review page: kept in this page only, for
 * trying the buttons out. Nothing is saved; the real buttons are on
 * Admin › Social.
 */

const Ctx = createContext<{ decisions: Decisions; total: number; press: (card: number, verdict: Verdict) => void } | null>(null);

function useDecisions() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ReviewDecisions is missing");
  return ctx;
}

export function ReviewDecisions({ total, children }: { total: number; children: React.ReactNode }) {
  const [decisions, setDecisions] = useState<Decisions>({});
  const press = (card: number, verdict: Verdict) => setDecisions((d) => decide(d, card, verdict));
  return <Ctx.Provider value={{ decisions, total, press }}>{children}</Ctx.Provider>;
}

export function ReviewDecisionCount() {
  const { decisions, total } = useDecisions();
  const c = countDecisions(decisions, total);
  return (
    <div id="sp-decisions" className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <p className="font-semibold">
        <span className="text-emerald-700">{c.approved} approved</span> · <span className="text-red-700">{c.denied} denied</span> · {c.undecided} undecided
      </p>
      <p className="mt-1 text-xs text-stone-600">
        These buttons only work on this page, to try them out: nothing is saved and nothing posts. The real Approve and Deny buttons are on Admin › Social, on each
        post in the week plan.
      </p>
    </div>
  );
}

export function ReviewDraftCard({ n, children }: { n: number; children: React.ReactNode }) {
  const { decisions, press } = useDecisions();
  const verdict = decisions[n];
  const frame = verdict === "approved" ? "border-emerald-500 ring-2 ring-emerald-500" : verdict === "denied" ? "border-red-500 ring-2 ring-red-500 opacity-70" : "border-stone-200";
  return (
    <li id={`sp-draft-${n}`} data-decision={verdict ?? "undecided"} className={`flex flex-col overflow-hidden rounded-lg border ${frame}`}>
      {verdict && (
        <p className={`px-3 py-1 text-xs font-bold uppercase tracking-wide text-white ${verdict === "approved" ? "bg-emerald-600" : "bg-red-600"}`}>
          {verdict === "approved" ? "Approved" : "Denied"}
        </p>
      )}
      {children}
      <div className="mt-auto flex gap-2 border-t border-stone-200 p-3">
        <button
          id={`sp-approve-${n}`}
          type="button"
          aria-pressed={verdict === "approved"}
          onClick={() => press(n, "approved")}
          className={`flex-1 rounded-md px-3 py-2 font-semibold ${verdict === "approved" ? "bg-emerald-700 text-white" : "border border-emerald-600 text-emerald-700 hover:bg-emerald-50"}`}
        >
          {verdict === "approved" ? "Approved ✓" : "Approve"}
        </button>
        <button
          id={`sp-deny-${n}`}
          type="button"
          aria-pressed={verdict === "denied"}
          onClick={() => press(n, "denied")}
          className={`flex-1 rounded-md px-3 py-2 font-semibold ${verdict === "denied" ? "bg-red-700 text-white" : "border border-red-600 text-red-700 hover:bg-red-50"}`}
        >
          {verdict === "denied" ? "Denied ✕" : "Deny"}
        </button>
      </div>
    </li>
  );
}
