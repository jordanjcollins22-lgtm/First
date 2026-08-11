"use client";

import { useState, useTransition } from "react";
import { Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteAttractorWave, updateAttractorWave } from "@/lib/actions/attractor-actions";
import { colorForAttractorType } from "./attractor-colors";
import type { AttractorType, AttractorVariant, AttractorWave, AttractorWaveStatus } from "@/types/domain";

const GEOMETRY_LABEL: Record<string, string> = {
  point_radius: "Address + radius",
  polygon: "Area (polygon)",
  route: "Route",
  zip_list: "Zip codes",
};

export function WaveDetailPanel({
  wave,
  types,
  variants,
  onClose,
  onDeleted,
}: {
  wave: AttractorWave;
  types: AttractorType[];
  variants: AttractorVariant[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const type = types.find((t) => t.id === wave.type_id);
  const variant = variants.find((v) => v.id === wave.variant_id);

  const [status, setStatus] = useState<AttractorWaveStatus>(wave.status);
  const [dateCompleted, setDateCompleted] = useState(wave.date_completed ?? "");
  const [quantity, setQuantity] = useState(wave.quantity_deployed?.toString() ?? "");
  const [notes, setNotes] = useState(wave.notes ?? "");
  const [leads, setLeads] = useState(wave.leads_generated?.toString() ?? "");
  const [projects, setProjects] = useState(wave.projects_generated?.toString() ?? "");
  const [revenue, setRevenue] = useState(wave.revenue_generated?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(patch: Parameters<typeof updateAttractorWave>[1]) {
    setError(null);
    startTransition(async () => {
      try {
        await updateAttractorWave(wave.id, patch);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${wave.name}"? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteAttractorWave(wave.id);
        onDeleted();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-semibold">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorForAttractorType(wave.type_id) }}
              aria-hidden
            />
            {wave.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {type?.label ?? wave.type_id}
            {variant && ` · ${variant.name}`} · {GEOMETRY_LABEL[wave.geometry_type] ?? wave.geometry_type}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label className="text-xs">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as AttractorWaveStatus);
              save({ status: v as AttractorWaveStatus });
            }}
            disabled={isPending}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label className="text-xs">Date completed</Label>
          <Input
            type="date"
            value={dateCompleted}
            disabled={isPending}
            onChange={(e) => setDateCompleted(e.target.value)}
            onBlur={() => save({ dateCompleted: dateCompleted || null })}
            className="h-9 text-sm"
          />
        </div>
      </div>

      {wave.date_planned && <p className="text-xs text-muted-foreground">Planned for {wave.date_planned}</p>}

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Quantity deployed</Label>
        <Input
          type="number"
          min={0}
          value={quantity}
          disabled={isPending}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={() => save({ quantityDeployed: quantity.trim() ? Number(quantity) : null })}
          className="h-9 text-sm"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Leads</Label>
          <Input
            type="number"
            min={0}
            value={leads}
            disabled={isPending}
            onChange={(e) => setLeads(e.target.value)}
            onBlur={() => save({ leadsGenerated: leads.trim() ? Number(leads) : null })}
            className="h-9 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Projects</Label>
          <Input
            type="number"
            min={0}
            value={projects}
            disabled={isPending}
            onChange={(e) => setProjects(e.target.value)}
            onBlur={() => save({ projectsGenerated: projects.trim() ? Number(projects) : null })}
            className="h-9 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Revenue</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={revenue}
            disabled={isPending}
            onChange={(e) => setRevenue(e.target.value)}
            onBlur={() => save({ revenueGenerated: revenue.trim() ? Number(revenue) : null })}
            className="h-9 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Notes</Label>
        <Textarea
          value={notes}
          disabled={isPending}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => save({ notes: notes.trim() || null })}
          className="h-16 text-sm"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={isPending} className="self-start text-destructive hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
        Delete wave
      </Button>
    </div>
  );
}
