"use client";

import { useState, useTransition } from "react";

import { setEmailKindMode } from "@/lib/actions/approval-queue-actions";
import { setEmailApprovalRequired } from "@/lib/actions/outbound-approval-actions";
import { APPROVAL_MODES, MODE_LABEL, type ApprovalMode } from "@/lib/approvals/policy";
import { whatLabel } from "@/lib/outbound-approval";

export interface PolicyRowView {
  kind: string;
  mode: ApprovalMode;
  isDefault: boolean;
  lowRisk: boolean;
  /** Fixed by the rules: a team request always waits. */
  locked: boolean;
}

/** The master hold, and one setting per kind of automatic email. */
export function EmailApprovalPolicyEditor({ masterHold, rows }: { masterHold: boolean; rows: PolicyRowView[] }) {
  const [held, setHeld] = useState(masterHold);
  const [modes, setModes] = useState<Record<string, ApprovalMode>>(Object.fromEntries(rows.map((r) => [r.kind, r.mode])));
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Master hold</p>
          <p className="text-sm text-muted-foreground">
            {held
              ? "On: every automatic email waits for you, whatever its setting below, and nothing sends itself."
              : "Off: each kind follows its setting below. AI-written emails, team requests and first sends still wait."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={held}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await setEmailApprovalRequired(!held);
              setNote(result.message);
              if (result.ok) setHeld(!held);
            })
          }
          className={"min-h-11 rounded-lg px-3 text-sm font-semibold " + (held ? "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100" : "border")}
        >
          {held ? "Holding everything" : "Following the policy"}
        </button>
      </div>

      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.kind} className="grid gap-2 rounded-lg border px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
            <span>
              <span className="font-semibold">{whatLabel(row.kind)}</span>
              <span className="block text-xs text-muted-foreground">
                {row.lowRisk ? "Transactional" : "Needs a read"}
                {row.isDefault && modes[row.kind] === row.mode ? " · default" : ""}
              </span>
            </span>
            <label className="sr-only" htmlFor={`mode-${row.kind}`}>Setting for {whatLabel(row.kind)}</label>
            <select
              id={`mode-${row.kind}`}
              value={modes[row.kind]}
              disabled={pending || row.locked}
              onChange={(e) => {
                const mode = e.target.value as ApprovalMode;
                const previous = modes[row.kind];
                setModes((m) => ({ ...m, [row.kind]: mode }));
                start(async () => {
                  const result = await setEmailKindMode(row.kind, mode);
                  setNote(result.message);
                  if (!result.ok) setModes((m) => ({ ...m, [row.kind]: previous }));
                });
              }}
              className="min-h-11 rounded-lg border bg-background px-2 text-sm disabled:opacity-60"
            >
              {APPROVAL_MODES.map((m) => (
                <option key={m} value={m}>{MODE_LABEL[m]}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {note && <p className="text-sm" role="status">{note}</p>}
    </div>
  );
}
