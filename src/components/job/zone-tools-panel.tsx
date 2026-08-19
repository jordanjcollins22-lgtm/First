"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Package, Wrench, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setZoneTools } from "@/lib/actions/zone-tools-actions";
import { addTools, hasAllTools, kitsFrom, removeTools, resolveTools } from "@/lib/tool-selection";
import type { Tool } from "@/types/domain";

export interface ZoneToolsRow {
  zoneId: string;
  zoneName: string;
  color: string;
  service: string;
  /** Whatever is stored — names, or ids from an older service default. */
  toolTokens: string[];
  /** The tools this service is set up with, offered as a starting point.
   * Suggested rather than applied: an empty zone means an empty zone. */
  defaultToolNames: string[];
}

/**
 * What each zone needs loaded.
 *
 * Tools used to ride along from the service's default kit with nobody able to
 * change them, which is fine until a job needs the compactor and the default
 * says it does not. This is the account manager's say over the load-out,
 * zone by zone, before the crew turn up without something.
 */
export function ZoneToolsPanel({
  jobId,
  zones,
  tools,
}: {
  jobId: string;
  zones: ZoneToolsRow[];
  tools: Tool[];
}) {
  if (zones.length === 0) return null;

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Wrench className="h-4 w-4" />
        Tools by zone
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        What the crew load for each zone. Everything picked here adds up into their list for the day.
      </p>

      <div className="flex flex-col gap-3">
        {zones.map((zone) => (
          <ZoneRow key={zone.zoneId} jobId={jobId} zone={zone} tools={tools} />
        ))}
      </div>
    </section>
  );
}

function ZoneRow({ jobId, zone, tools }: { jobId: string; zone: ZoneToolsRow; tools: Tool[] }) {
  // Held locally so a picker feels immediate; saved on Done, because saving
  // per tap would fire a write for every tick on a slow connection.
  const [picked, setPicked] = useState<string[]>(() =>
    resolveTools(zone.toolTokens, tools).map((t) => t.name)
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const kits = kitsFrom(tools);
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  /** Kit and "usual" buttons toggle: tap to apply, tap again to take back.
   * Add-only left no way to undo a mis-tap short of unticking each tool. */
  function toggleGroup(names: string[]) {
    setPicked((current) =>
      hasAllTools(current, names) ? removeTools(current, names) : addTools(current, names)
    );
  }

  function toggle(name: string) {
    setPicked((current) =>
      current.some((n) => n.toLowerCase() === name.toLowerCase())
        ? current.filter((n) => n.toLowerCase() !== name.toLowerCase())
        : [...current, name]
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setZoneTools(jobId, zone.zoneId, picked);
      if (!result.ok) setError(result.message);
      else setOpen(false);
    });
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: zone.color }} aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{zone.zoneName}</p>
        <span className="shrink-0 text-xs text-muted-foreground">{zone.service}</span>
      </div>

      {picked.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing picked — the crew get no list for this zone.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {picked.map((name) => (
            <li
              key={name}
              className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium"
            >
              {name}
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 flex min-h-9 items-center text-xs font-medium text-primary hover:underline"
        >
          Choose tools
        </button>
      ) : (
        <div className="mt-2 rounded-lg border border-border bg-background/60 p-2.5">
          {zone.defaultToolNames.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Usual for {zone.service}
              </p>
              <button
                type="button"
                onClick={() => toggleGroup(zone.defaultToolNames)}
                title={zone.defaultToolNames.join(", ")}
                className={`flex min-h-9 items-center gap-1 rounded-md border px-2 text-[11px] font-medium ${
                  hasAllTools(picked, zone.defaultToolNames)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-accent"
                }`}
              >
                {hasAllTools(picked, zone.defaultToolNames) && <Check className="h-3 w-3" />}
                The usual {zone.defaultToolNames.length}
              </button>
            </div>
          )}

          {kits.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Package className="h-3 w-3" />
                Kits — tap to add, tap again to remove
              </p>
              <div className="flex flex-wrap gap-1.5">
                {kits.map((kit) => {
                  const on = hasAllTools(picked, kit.toolNames);
                  return (
                    <button
                      key={kit.number}
                      type="button"
                      onClick={() => toggleGroup(kit.toolNames)}
                      title={kit.toolNames.join(", ")}
                      className={`flex min-h-9 items-center gap-1 rounded-md border px-2 text-[11px] font-medium ${
                        on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                      Kit {kit.number}
                      <span className={on ? "" : "text-muted-foreground"}>({kit.toolNames.length})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tools
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((tool) => {
              const on = picked.some((n) => n.toLowerCase() === tool.name.toLowerCase());
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => toggle(tool.name)}
                  className={`flex min-h-9 items-center gap-1 rounded-md border px-2 text-[11px] font-medium ${
                    on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
                  }`}
                >
                  {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 opacity-30" />}
                  {tool.name}
                  {tool.is_rental && <span className="text-[10px] text-amber-700">rental</span>}
                </button>
              );
            })}
          </div>

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="min-h-11 sm:min-h-9" disabled={isPending} onClick={save}>
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Done
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              disabled={isPending}
              onClick={() => {
                setPicked(resolveTools(zone.toolTokens, tools).map((t) => t.name));
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
