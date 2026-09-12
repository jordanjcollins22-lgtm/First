"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { colorForAttractorType } from "./attractor-colors";
import type { AttractorType, AttractorWave } from "@/types/domain";

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  ready: "Ready",
  completed: "Completed",
};

export function WaveList({
  waves,
  types,
  visibleWaveIds,
  onToggleVisible,
  selectedWaveId,
  onSelect,
}: {
  waves: AttractorWave[];
  types: AttractorType[];
  visibleWaveIds: Set<string>;
  onToggleVisible: (id: string) => void;
  selectedWaveId: string | null;
  onSelect: (id: string) => void;
}) {
  if (waves.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">No Attractor Waves match the current filters.</p>;
  }

  return (
    <ul className="flex flex-col gap-1 p-2">
      {waves.map((wave) => {
        const type = types.find((t) => t.id === wave.type_id);
        const visible = visibleWaveIds.has(wave.id);
        return (
          <li
            key={wave.id}
            className={`flex items-center gap-2 rounded-md p-1.5 text-sm ${
              wave.id === selectedWaveId ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            <Checkbox
              checked={visible}
              onCheckedChange={() => onToggleVisible(wave.id)}
              aria-label={`Show ${wave.name}`}
              className="h-4 w-4"
            />
            <button type="button" onClick={() => onSelect(wave.id)} className="flex flex-1 items-center gap-2 text-left">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorForAttractorType(wave.type_id), opacity: wave.status === "completed" ? 1 : 0.4 }}
                aria-hidden
              />
              <span className="flex-1 truncate">{wave.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {type?.label ?? wave.type_id}
              </span>
              <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {STATUS_LABEL[wave.status] ?? wave.status}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
