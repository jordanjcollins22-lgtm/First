"use client";

import { useState, useTransition } from "react";
import { v4 as uuid } from "uuid";
import { Plus, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChipRow } from "@/components/ui/chip-row";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { REQUEST_SOURCES, sourceLabel, type RequestSource } from "@/lib/change-source";
import {
  editFor,
  manualZoneReady,
  needsLinearAnswer,
  type EditableZone,
  type ZoneEdit,
} from "@/lib/evaluation-edit";
import {
  saveEvaluationChanges,
  type ManualZoneInput,
} from "@/lib/actions/evaluation-edit-actions";

export interface EvaluationEditRecord {
  id: string;
  createdAt: string;
  editedByName: string | null;
  changes: string[];
  requestedVia: string | null;
  note: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const COLORS = ["#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

/**
 * Changing an evaluation by typing rather than by drawing.
 *
 * A client texts "the back bed is more like thirty foot" or "can you do the
 * side hedge as well". Acting on that used to mean reopening the site map on
 * a phone and redrawing, which is fiddly, and is drawing when what actually
 * changed is a number.
 *
 * So the numbers and the wording are editable from a list, an area can be
 * added with nothing drawn for it, and every save records what moved and how
 * they asked. An area added here has no shape on the map on purpose: a
 * rectangle invented in the office would show on the client's site map as
 * though somebody had stood there and measured it.
 */
export function EvaluationChangesPanel({
  jobId,
  zones,
  services,
  history,
}: {
  jobId: string;
  zones: EditableZone[];
  /** What can be put on a new area, from the org's rate card. */
  services: { id: string; name: string }[];
  history: EvaluationEditRecord[];
}) {
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState<Record<string, ZoneEdit>>(() =>
    Object.fromEntries(zones.map((z) => [z.id, editFor(z)]))
  );
  const [removed, setRemoved] = useState<string[]>([]);
  const [adding, setAdding] = useState<ManualZoneInput[]>([]);
  const [source, setSource] = useState<RequestSource>("text");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setEdit(id: string, patch: Partial<ZoneEdit>) {
    setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function addArea() {
    setAdding((current) => [
      ...current,
      {
        id: uuid(),
        name: "",
        serviceTypeId: services[0]?.id ?? null,
        length: "",
        width: "",
        linear: false,
        notes: "",
        color: COLORS[(zones.length + current.length) % COLORS.length],
      },
    ]);
  }

  function setAdd(id: string, patch: Partial<ManualZoneInput>) {
    setAdding((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  const unanswered = Object.values(edits).some(
    (edit) => !removed.includes(edit.id) && needsLinearAnswer(edit)
  );
  const incompleteAdd = adding.some((a) => !manualZoneReady(a));

  function save() {
    setError(null);
    start(async () => {
      const result = await saveEvaluationChanges({
        jobId,
        edits: Object.values(edits).filter((e) => !removed.includes(e.id)),
        removeZoneIds: removed,
        addZones: adding,
        requestedVia: source,
        note,
      });
      if (result.ok) {
        setOpen(false);
        setRemoved([]);
        setAdding([]);
        setNote("");
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!open && (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} className="self-start">
          Enter a change
        </Button>
      )}

      {open && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-semibold">What changed?</p>

          <ChipRow options={REQUEST_SOURCES} value={source} onChange={setSource} />

          {zones.length === 0 && adding.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nothing measured yet. Add an area below, or draw it on the map.
            </p>
          )}

          {zones.map((zone) => {
            const edit = edits[zone.id];
            if (!edit) return null;
            const gone = removed.includes(zone.id);
            return (
              <div
                key={zone.id}
                className={`flex flex-col gap-2 rounded-lg border border-white/60 bg-card/70 p-2.5 ${
                  gone ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Input
                    value={edit.name}
                    onChange={(e) => setEdit(zone.id, { name: e.target.value })}
                    disabled={gone || pending}
                    className="h-9 flex-1 text-sm font-semibold"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 shrink-0 px-2"
                    onClick={() =>
                      setRemoved((current) =>
                        gone ? current.filter((id) => id !== zone.id) : [...current, zone.id]
                      )
                    }
                  >
                    {gone ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>

                {!gone && (
                  <>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={edit.length}
                        onChange={(e) => setEdit(zone.id, { length: e.target.value })}
                        placeholder="Length"
                        className="h-9 w-24 text-sm"
                        disabled={pending}
                      />
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={edit.width}
                        onChange={(e) => setEdit(zone.id, { width: e.target.value, linear: false })}
                        placeholder="Width"
                        className="h-9 w-24 text-sm"
                        disabled={pending || edit.linear}
                      />
                      <span className="text-xs text-muted-foreground">ft</span>
                    </div>

                    {/* A length with no width means "this is a run" or "I have
                        not finished typing", and only a person knows which. */}
                    {needsLinearAnswer(edit) && (
                      <button
                        type="button"
                        onClick={() => setEdit(zone.id, { linear: true, width: "" })}
                        className="self-start text-xs font-semibold text-primary"
                      >
                        No width — this is a {edit.length || "0"} ft run
                      </button>
                    )}
                    {edit.linear && (
                      <button
                        type="button"
                        onClick={() => setEdit(zone.id, { linear: false })}
                        className="self-start text-xs text-muted-foreground"
                      >
                        Measured as a run. Tap to give it a width instead.
                      </button>
                    )}

                    <AutoTextarea
                      value={edit.notes}
                      onChange={(e) => setEdit(zone.id, { notes: e.target.value })}
                      rows={1}
                      placeholder="Notes for this area"
                      className="min-h-9 py-2 text-sm"
                      disabled={pending}
                    />
                  </>
                )}
              </div>
            );
          })}

          {adding.map((area) => (
            <div key={area.id} className="flex flex-col gap-2 rounded-lg border border-dashed border-primary/40 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <Input
                  value={area.name}
                  onChange={(e) => setAdd(area.id, { name: e.target.value })}
                  placeholder="Area name (e.g. Side hedge)"
                  className="h-9 flex-1 text-sm font-semibold"
                  disabled={pending}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 shrink-0 px-2"
                  onClick={() => setAdding((current) => current.filter((a) => a.id !== area.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <select
                value={area.serviceTypeId ?? ""}
                onChange={(e) => setAdd(area.id, { serviceTypeId: e.target.value || null })}
                className="h-9 rounded-md border border-input bg-card/80 px-2 text-sm"
                disabled={pending}
              >
                <option value="">Pick a service</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={area.length}
                  onChange={(e) => setAdd(area.id, { length: e.target.value })}
                  placeholder="Length"
                  className="h-9 w-24 text-sm"
                  disabled={pending}
                />
                <span className="text-xs text-muted-foreground">×</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={area.width}
                  onChange={(e) => setAdd(area.id, { width: e.target.value, linear: false })}
                  placeholder="Width"
                  className="h-9 w-24 text-sm"
                  disabled={pending || area.linear}
                />
                <span className="text-xs text-muted-foreground">ft</span>
              </div>

              {area.length && !area.width && !area.linear && (
                <button
                  type="button"
                  onClick={() => setAdd(area.id, { linear: true })}
                  className="self-start text-xs font-semibold text-primary"
                >
                  No width — this is a {area.length} ft run
                </button>
              )}

              <p className="text-xs text-muted-foreground">
                Nothing is drawn on the map for this one, since nobody stood there to measure it.
              </p>
            </div>
          ))}

          <Button type="button" size="sm" variant="ghost" onClick={addArea} className="self-start">
            <Plus className="h-4 w-4" />
            Add an area
          </Button>

          <AutoTextarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={1}
            placeholder="What did they say? (optional)"
            className="min-h-10 py-2 text-sm"
            disabled={pending}
          />

          {unanswered && (
            <p className="text-xs text-amber-600">
              One area has a length and no width. Say whether it is a run before saving.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || unanswered || incompleteAdd}
              onClick={save}
            >
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            This updates the measurements the proposal is priced from. Rebuild the proposal after
            saving to put the new numbers in front of the client.
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-white/60 bg-card/50 p-2.5">
          <p className="text-xs font-semibold text-muted-foreground">Changes since the walk</p>
          {history.map((entry) => (
            <div key={entry.id} className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                {sourceLabel(entry.requestedVia) ?? "Changed"}
                {entry.editedByName ? `, entered by ${entry.editedByName}` : ""} on{" "}
                {formatDate(entry.createdAt)}
              </p>
              {entry.note && <p className="italic">&ldquo;{entry.note}&rdquo;</p>}
              <ul className="list-disc pl-4">
                {entry.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
