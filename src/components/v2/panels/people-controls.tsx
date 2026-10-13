"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fixProfileRoles, setOnboardingItem, updateChecklist } from "@/lib/actions/back-office-actions";
import { ROLE_KEY_LABEL, canonicalName, type RoleFix } from "@/lib/hr/role-mapping";
import type { RoleKey } from "@/lib/roles";

/**
 * The one-tap role fix. For somebody with no recognised role, the suggested
 * role can be changed before tapping; legacy names and conflicts have one
 * obvious fix and get just the button.
 */
export function RoleFixButton({ profileId, fix, choose }: { profileId: string; fix: RoleFix; choose: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(fix.add[0] ?? "");
  const keys = Object.keys(ROLE_KEY_LABEL) as RoleKey[];
  return (
    <span className="flex flex-wrap items-center gap-1">
      {choose && (
        <select aria-label="Role" className="h-11 rounded-md border bg-background px-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
          {keys.map((k) => (
            <option key={k} value={canonicalName(k)}>
              {ROLE_KEY_LABEL[k]}
            </option>
          ))}
        </select>
      )}
      <Button
        type="button"
        size="sm"
        className="min-h-11"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await fixProfileRoles({ profileId, add: choose ? [pick] : fix.add, remove: fix.remove });
            setError(r.ok ? null : r.error);
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {choose ? "Give role" : fix.label}
      </Button>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** Tick, waive or reopen a checklist item. */
export function ItemToggle({ itemId, done, waived }: { itemId: string; done: boolean; waived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (state: "done" | "waived" | "open") =>
    start(async () => {
      await setOnboardingItem({ itemId, state });
      router.refresh();
    });
  if (done || waived) {
    return (
      <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={pending} onClick={() => run("open")}>
        Undo
      </Button>
    );
  }
  return (
    <span className="flex gap-1">
      <Button type="button" size="sm" className="min-h-11" disabled={pending} onClick={() => run("done")}>
        Done
      </Button>
      <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={pending} onClick={() => run("waived")}>
        Doesn&apos;t apply
      </Button>
    </span>
  );
}

/** A hire's first day and whether they handle pesticides: change either and the due dates follow. */
export function ChecklistSettings({ checklistId, startDate, handlesPesticides }: { checklistId: string; startDate: string; handlesPesticides: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (patch: { startDate?: string; handlesPesticides?: boolean }) =>
    start(async () => {
      await updateChecklist({ checklistId, ...patch });
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        First day
        <input type="date" defaultValue={startDate} disabled={pending} className="h-11 rounded-md border bg-background px-2" onChange={(e) => e.target.value && save({ startDate: e.target.value })} />
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="h-5 w-5" defaultChecked={handlesPesticides} disabled={pending} onChange={(e) => save({ handlesPesticides: e.target.checked })} />
        Handles pesticides
      </label>
    </div>
  );
}
