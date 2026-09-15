"use client";

import { useState, useTransition } from "react";
import { Crosshair, Loader2, MapPin, Pencil, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteOperationsTarget,
  rebuildCourtTargets,
  saveOperationsTarget,
  setOperationsTargetStatus,
} from "@/lib/actions/operations-target-actions";
import { courtTitle, VERDICT_COLOR, VERDICT_LABEL, type RankedCourt } from "@/lib/court-score";
import type { OperationsTarget, OperationsTargetStatus } from "@/lib/data/operations-targets";
import type { LatLng } from "@/types/domain";

/**
 * Where operations goes next.
 *
 * The courts the county's data says are worth owning, best first, with the
 * reasons; and the outlines the office has drawn round the groups of homes
 * it means to work as one. Pick a court and it becomes a target with its
 * ring already drawn; or draw a ring by hand round any group of homes.
 */
export function OperationsTargetsPanel({
  courts,
  totalCourts,
  builtAt,
  targets,
  showCourts,
  onToggleShowCourts,
  onFocusCourt,
  onFocusTarget,
  onRequestDraw,
  drawnPoints,
  onDrawnConsumed,
  pendingCourt,
  onClearPendingCourt,
  onTargetsChanged,
}: {
  courts: RankedCourt[];
  totalCourts: number;
  builtAt: string | null;
  targets: OperationsTarget[];
  showCourts: boolean;
  onToggleShowCourts: () => void;
  onFocusCourt: (court: RankedCourt) => void;
  onFocusTarget: (target: OperationsTarget) => void;
  onRequestDraw: () => void;
  /** The ring just drawn on the map, waiting for a name. */
  drawnPoints: LatLng[] | null;
  onDrawnConsumed: () => void;
  /** A court picked on the map or in the list, waiting to be saved. */
  pendingCourt: { court: { id: string; title: string }; points: LatLng[] } | null;
  onClearPendingCourt: () => void;
  onTargetsChanged: (targets: OperationsTarget[]) => void;
}) {
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const pending = pendingCourt
    ? { title: pendingCourt.court.title, points: pendingCourt.points, courtId: pendingCourt.court.id }
    : drawnPoints
      ? { title: "", points: drawnPoints, courtId: null }
      : null;

  function rebuild() {
    setMessage(null);
    startTransition(async () => {
      const result = await rebuildCourtTargets();
      setMessage(result.ok ? `${result.value.courts.toLocaleString()} courts ranked. Reload to see the new order.` : result.message);
    });
  }

  function save() {
    if (!pending) return;
    const finalName = (name || pending.title).trim();
    if (!finalName) {
      setMessage("Give the target a name.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await saveOperationsTarget({ name: finalName, points: pending.points, courtId: pending.courtId, notes });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      onTargetsChanged([result.value, ...targets]);
      setName("");
      setNotes("");
      onDrawnConsumed();
      onClearPendingCourt();
    });
  }

  function cancelPending() {
    setName("");
    setNotes("");
    onDrawnConsumed();
    onClearPendingCourt();
  }

  function setStatus(target: OperationsTarget, status: OperationsTargetStatus) {
    startTransition(async () => {
      const result = await setOperationsTargetStatus(target.id, status);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      onTargetsChanged(targets.map((t) => (t.id === target.id ? { ...t, status } : t)));
    });
  }

  function remove(target: OperationsTarget) {
    if (!window.confirm(`Remove the target "${target.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteOperationsTarget(target.id);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      onTargetsChanged(targets.filter((t) => t.id !== target.id));
    });
  }

  const targetedCourtIds = new Set(targets.map((t) => t.courtId).filter(Boolean));
  const listed = showAll ? courts : courts.slice(0, 12);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Crosshair className="h-4 w-4" />
              Operations targets
            </h3>
            <p className="text-xs text-muted-foreground">
              Courts to own: one parking spot, a ring of homes that all see the work.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onRequestDraw} disabled={busy || Boolean(pending)}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Outline a target
          </Button>
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={showCourts} onChange={onToggleShowCourts} className="h-3.5 w-3.5" />
          Show the best courts on the map
        </label>
      </div>

      {pending && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-semibold">{pending.courtId ? `Save ${pending.title} as a target` : "Name the outline you drew"}</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={pending.title || "e.g. Brook Hill Ct group"}
            className="mt-2 h-8 text-sm"
          />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="mt-2 h-8 text-sm" />
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Save target
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancelPending} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      {targets.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Targets ({targets.length})</p>
          <ul className="space-y-1.5">
            {targets.map((t) => (
              <li key={t.id} className="rounded-md border border-border p-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => onFocusTarget(t)}>
                    <MapPin className="mr-1 inline h-3 w-3" />
                    {t.name}
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(t)} title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  {t.houseCount != null && <span>{t.houseCount} homes inside</span>}
                  <select
                    value={t.status}
                    onChange={(e) => setStatus(t, e.target.value as OperationsTargetStatus)}
                    className="h-6 rounded border border-border bg-background px-1 text-xs"
                  >
                    <option value="planned">Planned</option>
                    <option value="active">Working it</option>
                    <option value="done">Done</option>
                  </select>
                  {t.notes && <span className="basis-full">{t.notes}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Best courts {totalCourts > 0 && `(of ${totalCourts.toLocaleString()})`}
          </p>
          <button type="button" onClick={rebuild} disabled={busy} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" title={builtAt ? `Ranked ${new Date(builtAt).toLocaleDateString()}` : "Rank the courts"}>
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            {courts.length === 0 ? "Rank the courts" : "Re-rank"}
          </button>
        </div>
        {courts.length === 0 && (
          <p className="text-xs text-muted-foreground">No courts ranked yet. Press &ldquo;Rank the courts&rdquo; to read them off the county&apos;s addresses.</p>
        )}
        <ol className="space-y-1.5">
          {listed.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="text-left font-medium hover:underline" onClick={() => onFocusCourt(c)}>
                  <span className="mr-1 inline-block min-w-[1.5rem] text-muted-foreground">#{c.rank}</span>
                  {courtTitle(c)}
                </button>
                <span className="shrink-0 rounded px-1.5 py-0.5 font-semibold text-white" style={{ background: VERDICT_COLOR[c.verdict] }}>
                  {c.score} {VERDICT_LABEL[c.verdict]}
                </span>
              </div>
              <p className="mt-0.5 text-muted-foreground">
                {c.houseCount} homes
                {c.assessedMedian != null && ` · ~$${Math.round(c.assessedMedian / 1000)}k`}
                {c.clients > 0 && ` · ${c.clients} client${c.clients === 1 ? "" : "s"} here`}
                {c.shopKm != null && ` · ${(c.shopKm * 0.621).toFixed(1)} mi from shop`}
              </p>
              <details className="mt-0.5">
                <summary className="cursor-pointer text-muted-foreground">Why</summary>
                <ul className="mt-1 space-y-0.5 tabular-nums">
                  {c.parts.map((p) => (
                    <li key={p.key} className="flex justify-between gap-2">
                      <span>
                        {p.label}: <span className="text-muted-foreground">{p.why}</span>
                      </span>
                      <span>
                        {p.points}/{p.max}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
              {targetedCourtIds.has(c.id) ? (
                <p className="mt-1 font-medium text-primary">Already a target</p>
              ) : (
                <button
                  type="button"
                  className="mt-1 text-primary hover:underline"
                  onClick={() => onFocusCourt(c)}
                >
                  Show on the map
                </button>
              )}
            </li>
          ))}
        </ol>
        {courts.length > 12 && (
          <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show ${courts.length - 12} more`}
          </button>
        )}
      </div>
    </div>
  );
}
