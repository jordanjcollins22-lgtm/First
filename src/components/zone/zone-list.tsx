"use client";

import { useState, useTransition } from "react";
import { Check, Pencil } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { renameZone } from "@/lib/actions/zone-actions";
import type { Zone } from "@/types/domain";

interface ZoneListProps {
  jobId: string;
  zones: Zone[];
  workAreaCountByZone: Map<string, number>;
  onChanged: () => void;
}

export function ZoneList({ jobId, zones, workAreaCountByZone, onChanged }: ZoneListProps) {
  if (zones.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No zones yet — draw work areas, then auto-cluster.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {zones.map((zone) => (
        <ZoneRow
          key={zone.id}
          jobId={jobId}
          zone={zone}
          count={workAreaCountByZone.get(zone.id) ?? 0}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function ZoneRow({
  jobId,
  zone,
  count,
  onChanged,
}: {
  jobId: string;
  zone: Zone;
  count: number;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(zone.name);
  const [isPending, startTransition] = useTransition();

  function save() {
    if (!name.trim() || name === zone.name) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      await renameZone(zone.id, jobId, name.trim());
      setEditing(false);
      onChanged();
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      {editing ? (
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="h-8"
          autoFocus
        />
      ) : (
        <span className="flex-1 text-sm font-medium">{zone.name}</span>
      )}
      <span className="text-xs text-muted-foreground">{count} area{count === 1 ? "" : "s"}</span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={isPending}
        onClick={() => (editing ? save() : setEditing(true))}
      >
        {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
