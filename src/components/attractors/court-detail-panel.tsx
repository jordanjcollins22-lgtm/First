"use client";

import { X, Crosshair, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { VERDICT_COLOR, VERDICT_LABEL, type CourtDetail } from "@/lib/court-score";
import type { OperationsTarget } from "@/lib/data/operations-targets";


/**
 * One court, as operations reads it.
 *
 * Clicking a court on the map used to open a small popup and, underneath
 * it, whatever marketing area happened to share the ground. The court is
 * the operations outline, so it gets the side panel: the score and every
 * line that earned it, what the county says about the homes, who is
 * already ours, and the two things to do about it.
 */
export function CourtDetailPanel({
  court,
  targeted,
  onSaveAsTarget,
  onEditOutline,
  onClose,
}: {
  court: CourtDetail;
  targeted: boolean;
  onSaveAsTarget: () => void;
  onEditOutline: () => void;
  onClose: () => void;
}) {
  const known = court.detached + court.townhouse + court.condo;
  const rows: [string, string][] = [
    ["Homes on the court", String(court.houses)],
    ["Assessed value", court.value != null ? `~$${Math.round(court.value / 1000)}k median` : "unknown"],
    ["Owner-occupied", court.ownerPct != null ? `${court.ownerPct}%` : "unknown"],
    [
      "Home type",
      known > 0
        ? [court.detached && `${court.detached} detached`, court.townhouse && `${court.townhouse} townhouse`, court.condo && `${court.condo} condo`].filter(Boolean).join(", ")
        : "unknown",
    ],
    ["Clients here", court.clients > 0 ? `${court.clients}${court.jobsDone > 0 ? ` · ${court.jobsDone} job${court.jobsDone === 1 ? "" : "s"} done` : ""}` : court.touched > 0 ? `none yet · ${court.touched} spoken to` : "none yet"],
    ["Spread", court.spreadM != null ? `${Math.round(court.spreadM)} m from the middle` : "unknown"],
    ["From the shop", court.shopKm != null ? `${(court.shopKm * 0.621).toFixed(1)} mi` : "unknown"],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operations outline · #{court.rank}</p>
          <h3 className="text-lg font-semibold">{court.title}</h3>
          {court.edited && <p className="text-xs text-muted-foreground">Outline drawn by hand</p>}
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded px-2 py-0.5 text-sm font-semibold text-white" style={{ background: VERDICT_COLOR[court.verdict] }}>
          {court.score} of 100
        </span>
        <span className="text-sm text-muted-foreground">{VERDICT_LABEL[court.verdict]} for operations</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">How it scored</p>
        <ul className="space-y-1 text-sm tabular-nums">
          {court.parts.map((p) => (
            <li key={p.key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-muted-foreground">{p.label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded bg-muted">
                <span className="block h-full rounded bg-primary" style={{ width: `${Math.round((100 * p.points) / p.max)}%` }} />
              </span>
              <span className="w-12 shrink-0 text-right">
                {p.points}/{p.max}
              </span>
              <span className="hidden w-40 shrink-0 truncate text-xs text-muted-foreground xl:inline" title={p.why}>
                {p.why}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        {targeted ? (
          <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Already a target</span>
        ) : (
          <Button type="button" size="sm" onClick={onSaveAsTarget}>
            <Crosshair className="mr-1 h-3.5 w-3.5" />
            Save as target
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onEditOutline}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Edit outline
        </Button>
      </div>
    </div>
  );
}

const STATUS_LINE: Record<string, string> = { planned: "Planned", active: "Working it", done: "Done" };

/** A saved target, with its few facts and the things to do to it. */
export function TargetDetailPanel({
  target,
  onReshape,
  onStatus,
  onRemove,
  onClose,
}: {
  target: OperationsTarget;
  onReshape: () => void;
  onStatus: (status: OperationsTarget["status"]) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operations target</p>
          <h3 className="text-lg font-semibold">{target.name}</h3>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Homes inside</dt>
        <dd className="font-medium">{target.houseCount ?? "unknown"}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <select value={target.status} onChange={(e) => onStatus(e.target.value as OperationsTarget["status"])} className="h-7 rounded border border-border bg-background px-1 text-sm">
            {Object.entries(STATUS_LINE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </dd>
        {target.notes && (
          <>
            <dt className="text-muted-foreground">Notes</dt>
            <dd>{target.notes}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onReshape}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Reshape
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Remove
        </Button>
      </div>
    </div>
  );
}
