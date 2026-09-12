import type { AuditEvent, CrewAssignment } from "@/lib/data/exceptions";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Who was on this job, and everything that was decided about it.
 *
 * Read-only and append-only: the database refuses an update or a delete on the
 * event table, so this is the same record three months later that it is today.
 * That matters more than it sounds -- almost every argument about a job is an
 * argument about who agreed what, and this is the only artefact that settles
 * one without anybody's memory being involved.
 */
export function JobHistory({ assignments, events }: { assignments: CrewAssignment[]; events: AuditEvent[] }) {
  const current = assignments.filter((a) => a.unassignedAt == null);
  const past = assignments.filter((a) => a.unassignedAt != null);

  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <h4 className="text-sm font-medium">On the job</h4>
        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is assigned yet.</p>
        ) : (
          <ul className="text-sm">
            {current.map((a) => (
              <li key={a.id}>
                {a.personName ?? "Somebody"}
                {a.role === "lead" ? " — lead" : ""}
                <span className="text-muted-foreground"> since {when(a.assignedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-medium">Was on the job</h4>
          <ul className="text-sm">
            {past.map((a) => (
              <li key={a.id}>
                {a.personName ?? "Somebody"}
                <span className="text-muted-foreground">
                  {" "}
                  until {when(a.unassignedAt!)}
                  {a.unassignReason ? ` — ${a.unassignReason}` : ""}
                  {a.replacedByName ? `, covered by ${a.replacedByName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1">
        <h4 className="text-sm font-medium">What was decided</h4>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has been decided on this job yet.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-muted-foreground">{when(e.at)}</span> · {e.actorName ?? "Somebody"} ·{" "}
                {e.subjectKind.replace("_", " ")} {e.action}
                {e.fromState && e.toState ? ` (${e.fromState} → ${e.toState})` : ""}
                {e.note ? <span className="block text-xs text-muted-foreground">{e.note}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
