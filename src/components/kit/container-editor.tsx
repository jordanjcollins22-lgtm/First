"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CONTAINER_KINDS, type KitContainer } from "@/lib/kit-containers";
import { archiveContainer, saveContainer } from "@/lib/actions/kit-container-actions";

/**
 * Naming the thing a kit travels in.
 *
 * The kits field takes whatever somebody types — "1, 2 and 3" is how a person
 * says it and refusing that in favour of a tag picker is a form nobody fills
 * in twice.
 */
export function ContainerEditor({
  container,
  onDone,
}: {
  container: KitContainer | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(container?.name ?? "");
  const [kits, setKits] = useState((container?.kits ?? []).join(", "));
  const [kind, setKind] = useState(container?.kind ?? "bought");
  const [quantity, setQuantity] = useState(container?.quantity?.toString() ?? "1");
  const [cost, setCost] = useState(container?.cost?.toString() ?? "");
  const [purchaseUrl, setPurchaseUrl] = useState(container?.purchaseUrl ?? "");
  const [reorderThreshold, setReorderThreshold] = useState(container?.reorderThreshold?.toString() ?? "");
  const [notes, setNotes] = useState(container?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await saveContainer({
        id: container?.id ?? null,
        name,
        kits,
        kind,
        quantity,
        cost,
        purchaseUrl,
        reorderThreshold,
        notes,
      });
      if (!result.ok) return setError(result.error);
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          What is it?{" "}
          <span className="font-normal text-muted-foreground">
            The thing you would say out loud at the van.
          </span>
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Trash can dolly setup"
          className="h-10"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Which kits are in it?{" "}
          <span className="font-normal text-muted-foreground">One rig often carries several.</span>
        </span>
        <Input value={kits} onChange={(e) => setKits(e.target.value)} placeholder="1, 2, 3" className="h-10" />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Bought or built?</span>
        <div className="flex flex-wrap gap-1.5">
          {CONTAINER_KINDS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setKind(option.key)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs",
                kind === option.key
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {CONTAINER_KINDS.find((option) => option.key === kind)?.blurb}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">How many</span>
          <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" className="h-10" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">{kind === "built" ? "Extra cost" : "Cost each"}</span>
          <Input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className="h-10" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Reorder at</span>
          <Input
            value={reorderThreshold}
            onChange={(e) => setReorderThreshold(e.target.value)}
            inputMode="numeric"
            className="h-10"
          />
        </label>
      </div>

      {kind === "built" && (
        <p className="-mt-1 text-xs text-muted-foreground">
          A built rig costs whatever its parts cost, added up below. Only put something here if there
          is a cost on top of them.
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Where to buy another{" "}
          <span className="font-normal text-muted-foreground">The link somebody will need at 6am</span>
        </span>
        <Input
          value={purchaseUrl}
          onChange={(e) => setPurchaseUrl(e.target.value)}
          placeholder="https://…"
          className="h-10"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Notes <span className="font-normal text-muted-foreground">Optional</span>
        </span>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : container ? "Save changes" : "Add it"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        {container && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await archiveContainer({ id: container.id, archived: !container.archivedAt });
                onDone();
              })
            }
            className="ml-auto text-xs text-muted-foreground underline"
          >
            {container.archivedAt ? "Bring it back" : "Archive it"}
          </button>
        )}
      </div>
    </div>
  );
}
