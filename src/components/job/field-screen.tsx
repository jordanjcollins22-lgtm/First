import Link from "next/link";
import { Camera, ClipboardList, Map, Navigation, Phone } from "lucide-react";

import type { Issue } from "@/lib/issues";
import { IssuesPanel } from "@/components/issues/issues-panel";
import { ReportException } from "@/components/exceptions/report-exception";
import { ProgressPanel } from "@/components/exceptions/progress-panel";
import type { ProgressUnit } from "@/lib/exceptions";
import type { ScopeChange } from "@/lib/data/exceptions";

/**
 * The crew's screen, for a phone in a garden.
 *
 * Everything a person standing on site reaches for, in one column of
 * thumb-sized rows: where the work is, what was sold, the sheet, the photos,
 * the way there, the client's number, and one control for saying something is
 * wrong. Nothing administrative -- no invoice, no payroll, no proposal
 * history. Those exist on this job and belong on other tabs.
 *
 * The scope is read-only here on purpose. What was sold is not a thing to
 * edit with a thumb in the rain; a change goes through Issues, where it is
 * recorded as a change rather than silently rewriting what the client agreed.
 */
export function FieldScreen({
  jobId,
  address,
  scopeLines,
  clientPhone,
  issues,
  canDecideBlocking,
  approvedAdditions,
  progress,
  workSessionId = null,
}: {
  jobId: string;
  address: string | null;
  scopeLines: string[];
  clientPhone: string | null;
  issues: Issue[];
  canDecideBlocking: boolean;
  /** Extra work the client has agreed to since. Approved, or it is not here. */
  approvedAdditions: ScopeChange[];
  progress: ProgressUnit[];
  workSessionId?: string | null;
}) {
  const maps = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;

  return (
    <div className="space-y-4">
      {address && (
        <p className="text-base font-medium">
          {address}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/jobs/${jobId}/work-order`}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
        >
          <ClipboardList className="h-5 w-5" /> Work order
        </Link>
        <Link
          href={`/jobs/${jobId}/directions`}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card/60 text-sm font-semibold"
        >
          <Navigation className="h-5 w-5" /> Directions
        </Link>
        <Link
          href={`/jobs/${jobId}?view=site`}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card/60 text-sm font-semibold"
        >
          <Map className="h-5 w-5" /> Site plan
        </Link>
        <Link
          href={`/jobs/${jobId}?view=photos`}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card/60 text-sm font-semibold"
        >
          <Camera className="h-5 w-5" /> Photos
        </Link>
        {clientPhone && (
          <a
            href={`tel:${clientPhone}`}
            className="col-span-2 flex min-h-14 items-center justify-center gap-2 rounded-xl border border-border bg-card/60 text-sm font-semibold"
          >
            <Phone className="h-5 w-5" /> Call the client
          </a>
        )}
        {maps && (
          <a
            href={maps}
            target="_blank"
            rel="noreferrer"
            className="col-span-2 flex min-h-12 items-center justify-center rounded-xl text-sm text-muted-foreground underline"
          >
            Open in Maps
          </a>
        )}
      </div>

      <section>
        <h2 className="mb-1.5 text-sm font-semibold">What was sold</h2>
        {scopeLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scope on this job yet.</p>
        ) : (
          <ul className="space-y-1 rounded-lg border border-border/60 p-3">
            {scopeLines.map((line, i) => (
              <li key={`${line}-${i}`} className="text-sm">
                {line}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Something different on site? Report it below rather than changing the scope — it gets recorded as a change.
        </p>
      </section>

      {/* Approved changes, kept separate from what was sold rather than mixed
          into it. The crew needs to know these are extra and that somebody
          agreed them; the sold scope stays the sold scope. */}
      {approvedAdditions.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-semibold">Also approved since</h2>
          <ul className="space-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            {approvedAdditions.map((change) => (
              <li key={change.id} className="text-sm">
                {change.requestedNote}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1.5 text-sm font-semibold">What got done</h2>
        <ProgressPanel jobId={jobId} units={progress} workSessionId={workSessionId} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Something come up?</h2>
        <p className="text-xs text-muted-foreground">
          Report it here instead of ringing the office. Whoever can decide it gets it straight away.
        </p>
        <ReportException jobId={jobId} workSessionId={workSessionId} />
      </section>

      <IssuesPanel jobId={jobId} issues={issues} canDecideBlocking={canDecideBlocking} compact />
    </div>
  );
}
