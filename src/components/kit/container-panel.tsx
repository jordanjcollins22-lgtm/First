"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, Minus, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  containerCost,
  containersValue,
  countOf,
  kitsLabel,
  needsAttention,
  reorderList,
  type KitContainer,
} from "@/lib/kit-containers";
import { money } from "@/lib/inventory-value";
import {
  markOnOrder,
  removePart,
  reportBroken,
  savePart,
} from "@/lib/actions/kit-container-actions";
import { ContainerEditor } from "@/components/kit/container-editor";

/**
 * The bins, and what is wrong with them.
 *
 * A kit is a set of tools that travels in something, and until now that
 * something was known only to whoever loads the van. Two things follow from
 * writing it down. The kit sheet can say what to look for, and a cracked crate
 * becomes an order rather than a thing somebody meant to mention.
 *
 * What needs replacing comes first, because it is the only part of this screen
 * with a consequence attached. Everything else is a list of boxes.
 */
export function ContainerPanel({ containers }: { containers: KitContainer[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const live = containers.filter((container) => !container.archivedAt);
  const wanted = reorderList(containers);

  function done() {
    setAdding(false);
    setEditing(null);
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">What the kits are stored in</h2>
          <p className="text-xs text-muted-foreground">
            {live.length === 0
              ? "Nothing recorded yet. A kit sheet cannot say which bin to check until one is."
              : `${live.length} container${live.length === 1 ? "" : "s"}, ${money(containersValue(containers))} of them.`}
          </p>
        </div>
        {!adding && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add one
          </Button>
        )}
      </div>

      {adding && <ContainerEditor container={null} onDone={done} />}

      {wanted.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <h3 className="text-sm font-semibold">
            {wanted.filter((item) => !item.onOrder).length} thing
            {wanted.filter((item) => !item.onOrder).length === 1 ? "" : "s"} to replace
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {wanted.map((item) => (
              <li
                key={`${item.containerId}:${item.partId ?? "self"}`}
                className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", item.onOrder && "opacity-60")}
              >
                <span className="font-medium">
                  {item.count > 1 ? `${item.count} × ` : ""}
                  {item.name}
                </span>
                {item.name !== item.containerName && (
                  <span className="text-muted-foreground">from the {item.containerName}</span>
                )}
                <span className="text-muted-foreground">
                  {item.reason === "broken" ? "broken" : "running low"}
                </span>
                {item.cost != null && <span className="tabular-nums">{money(item.cost * item.count)}</span>}
                {item.purchaseUrl && (
                  <a
                    href={item.purchaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    Buy <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <OrderToggle
                  containerId={item.containerId}
                  partId={item.partId}
                  onOrder={item.onOrder}
                  onDone={() => router.refresh()}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {containers.map((container) =>
        editing === container.id ? (
          <ContainerEditor key={container.id} container={container} onDone={done} />
        ) : (
          <ContainerCard
            key={container.id}
            container={container}
            onEdit={() => setEditing(container.id)}
            onChanged={() => router.refresh()}
          />
        )
      )}
    </section>
  );
}

function ContainerCard({
  container,
  onEdit,
  onChanged,
}: {
  container: KitContainer;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const cost = containerCost(container);
  const have = countOf(container);

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        needsAttention(container) ? "border-amber-500/50" : "border-border",
        container.archivedAt && "opacity-60"
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{container.name}</span>
        <span className="text-xs text-muted-foreground">{kitsLabel(container.kits)}</span>
        {container.archivedAt && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">Archived</span>}
        <button type="button" onClick={onEdit} className="ml-auto text-xs text-muted-foreground underline">
          Edit
        </button>
      </div>

      <p className="mt-0.5 text-xs text-muted-foreground">
        {have} of them{cost != null ? `, ${money(cost)} each` : ", no price on it yet"}
        {container.kind === "built" ? ", built from parts" : ""}
        {container.notes ? ` — ${container.notes}` : ""}
      </p>

      {/* The whole container, for one bought off a shelf. A built rig breaks a
          part at a time, so its broken count sits on the parts instead. */}
      {container.kind === "bought" && (
        <div className="mt-2">
          <BrokenControl
            label={container.name}
            containerId={container.id}
            partId={null}
            broken={container.broken}
            onDone={onChanged}
          />
        </div>
      )}

      {container.kind === "built" && (
        <PartList container={container} onChanged={onChanged} />
      )}
    </div>
  );
}

function PartList({ container, onChanged }: { container: KitContainer; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const parts = container.parts
    .slice()
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {parts.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">
          No parts listed. Add them and a snapped strap becomes an order instead of something
          somebody meant to mention.
        </p>
      )}

      {parts.map((part) => (
        <div key={part.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border px-2.5 py-2">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium">
            {part.quantity > 1 ? `${part.quantity} × ` : ""}
            {part.name}
          </span>
          {part.cost != null && <span className="text-xs tabular-nums text-muted-foreground">{money(part.cost)}</span>}
          {part.purchaseUrl && (
            <a
              href={part.purchaseUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs underline"
            >
              Buy <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <div className="ml-auto flex items-center gap-2">
            <BrokenControl
              label={part.name}
              containerId={container.id}
              partId={part.id}
              broken={part.broken}
              onDone={onChanged}
            />
            <RemovePart id={part.id} onDone={onChanged} />
          </div>
        </div>
      ))}

      {adding ? (
        <PartEditor
          containerId={container.id}
          position={parts.length}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start text-xs text-muted-foreground underline"
        >
          Add a part
        </button>
      )}
    </div>
  );
}

function PartEditor({
  containerId,
  position,
  onDone,
}: {
  containerId: string;
  position: number;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cost, setCost] = useState("");
  const [purchaseUrl, setPurchaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-2.5">
      <div className="grid grid-cols-4 gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Two-wheel dolly"
          className="col-span-2 h-9 text-sm"
        />
        <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" className="h-9 text-sm" />
        <Input
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          inputMode="decimal"
          placeholder="$"
          className="h-9 text-sm"
        />
      </div>
      <Input
        value={purchaseUrl}
        onChange={(e) => setPurchaseUrl(e.target.value)}
        placeholder="Where to buy another"
        className="h-9 text-sm"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await savePart({
                id: null,
                containerId,
                name,
                quantity,
                cost,
                purchaseUrl,
                position,
              });
              if (!result.ok) return setError(result.error);
              onDone();
            })
          }
        >
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * How many of it are broken.
 *
 * A count rather than a switch. Two cracked crates and one cracked crate are
 * different orders, and a switch makes somebody remember the difference on the
 * drive to the shop.
 */
function BrokenControl({
  label,
  containerId,
  partId,
  broken,
  onDone,
}: {
  label: string;
  containerId: string;
  partId: string | null;
  broken: number;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  function set(next: number) {
    start(async () => {
      await reportBroken({ containerId, partId, broken: next });
      onDone();
    });
  }

  if (broken === 0) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => set(1)}
        className="text-xs text-muted-foreground underline"
        aria-label={`Report ${label} broken`}
      >
        Report broken
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-xs">
      <button
        type="button"
        disabled={pending}
        onClick={() => set(broken - 1)}
        className="p-0.5"
        aria-label={`One fewer ${label} broken`}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="tabular-nums">{broken} broken</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => set(broken + 1)}
        className="p-0.5"
        aria-label={`One more ${label} broken`}
      >
        <Plus className="h-3 w-3" />
      </button>
    </span>
  );
}

function OrderToggle({
  containerId,
  partId,
  onOrder,
  onDone,
}: {
  containerId: string;
  partId: string | null;
  onOrder: boolean;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markOnOrder({ containerId, partId, onOrder: !onOrder });
          onDone();
        })
      }
      className="ml-auto underline"
    >
      {onOrder ? "Ordered — undo" : "Mark ordered"}
    </button>
  );
}

function RemovePart({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removePart({ id });
          onDone();
        })
      }
      className="text-xs text-muted-foreground underline"
    >
      Remove
    </button>
  );
}
