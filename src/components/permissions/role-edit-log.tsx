"use client";

import { useMemo, useState } from "react";

import { tabLabel } from "@/lib/permissions";
import type { RoleEdit } from "@/lib/data/permissions";

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

/** "Gave it Crew sheet", "Added Shalon Coleman", in the words somebody would say. */
function what(edit: RoleEdit): string {
  switch (edit.action) {
    case "created":
      return "Created the role";
    case "deleted":
      return "Deleted the role";
    case "renamed":
      return `Renamed it from ${edit.subject ?? "its old name"}`;
    case "permission_granted":
      return `Gave it ${edit.subject ? tabLabel(edit.subject) : "a page"}`;
    case "permission_removed":
      return `Took away ${edit.subject ? tabLabel(edit.subject) : "a page"}`;
    case "person_added":
      return `Added ${edit.subject ?? "somebody"}`;
    case "person_removed":
      return `Removed ${edit.subject ?? "somebody"}`;
  }
}

/**
 * Every change made to every role, newest first, with who made it and when.
 * Pick a role to see only its changes.
 */
export function RoleEditLog({ edits }: { edits: RoleEdit[] }) {
  const roles = useMemo(() => [...new Set(edits.map((e) => e.role))].sort((a, b) => a.localeCompare(b)), [edits]);
  const [role, setRole] = useState<string>("all");
  const shown = role === "all" ? edits : edits.filter((e) => e.role === role);

  return (
    <section className="mt-8">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Role edit log</h2>
          <p className="text-sm text-muted-foreground">
            Every change to a role, when it was made and who made it. Nobody can edit or delete a line.
          </p>
        </div>
        {roles.length > 0 && (
          <label className="flex flex-col gap-1 text-xs font-medium">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm capitalize">
              <option value="all">Every role</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">
          No changes yet. From now on every change to a role is written here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card/60">
          {shown.map((edit) => (
            <li key={edit.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span>
                <span className="font-semibold capitalize">{edit.role}</span>: {what(edit)}
              </span>
              <span className="text-xs text-muted-foreground">
                {edit.by ?? "The system"} · {WHEN.format(new Date(edit.at))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
