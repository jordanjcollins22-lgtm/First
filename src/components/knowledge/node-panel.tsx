"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  NODE_STATUSES,
  NODE_TYPES,
  RELATIONSHIP_TYPES,
  findSimilarNodes,
  neighboursOf,
  nodeTypeDef,
  relationshipDef,
  type Graph,
  type GraphNode,
  type Neighbour,
  type NodeStatus,
  type NodeType,
  type RelationshipType,
} from "@/lib/knowledge-graph";
import { INVENTORY_GROUPS, type InventoryGroup, type MaterialOption } from "@/lib/inventory-groups";
import { describePurchaseUrl } from "@/lib/purchase-url";
import type { UnitOption } from "@/lib/data/knowledge-graph";
import { InventoryAddForm } from "@/components/inventory/inventory-add-form";
import {
  InventoryKindChoice,
  basisFor,
  type InventoryKind,
} from "@/components/inventory/inventory-kind-choice";
import {
  costOf,
  defaultCostBasis,
  suggestedQuantity,
  describeQuantity,
  hours as formatHours,
  isCapital,
  money,
  unitDef,
} from "@/lib/knowledge-cost";
import { paybackOf } from "@/lib/knowledge-leverage";
import {
  addEarner,
  addRequirement,
  addUnit,
  deleteNode,
  deleteRelationship,
  linkNodeToMaterial,
  markNodeDone,
  reorderSteps,
  updateRelationship,
  scheduleNode,
  updateNode,
} from "@/lib/actions/knowledge-graph-actions";
import {
  RECURRENCES,
  describeDue,
  describeRecurrence,
  todayKey,
  type Recurrence,
} from "@/lib/knowledge-schedule";

/**
 * One node, everything about it, and everything touching it.
 *
 * The two connection lists are kept apart on purpose. "This needs a printer"
 * and "the flyers need this" are different questions with different answers,
 * and a single merged list of arrows is how somebody reads the graph
 * backwards without noticing.
 */
export function NodePanel({
  graph,
  node,
  materials,
  units,
  storageLocations,
  availableKits,
  canDelete,
  onClose,
  onFocus,
  onSelect,
  onChanged,
}: {
  graph: Graph;
  node: GraphNode;
  /** Everything in inventory, for linking this node to the real thing. */
  materials: MaterialOption[];
  /** Every unit this business measures in, built-in and home-made. */
  units: UnitOption[];
  /** What the inventory add forms need, so adding something new here is the
   * same form as adding it on the Inventory page. */
  storageLocations: string[];
  availableKits: number[];
  canDelete: boolean;
  onClose: () => void;
  onFocus: () => void;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState(node.title);
  const [nodeType, setNodeType] = useState<NodeType>(node.nodeType);
  const [status, setStatus] = useState<NodeStatus>(node.status);
  const [description, setDescription] = useState(node.description ?? "");
  const [notes, setNotes] = useState(node.notes ?? "");
  const [importance, setImportance] = useState(node.importance ? String(node.importance) : "");
  const [tags, setTags] = useState(node.tags.join(", "));
  const [unit, setUnit] = useState(node.unit);
  const [runSize, setRunSize] = useState(node.runSize != null ? String(node.runSize) : "");
  const [runUnit, setRunUnit] = useState(node.runUnit ?? "");
  const [outputPerUnit, setOutputPerUnit] = useState(
    node.outputPerUnit != null ? String(node.outputPerUnit) : ""
  );
  const [outputUnit, setOutputUnit] = useState(node.outputUnit ?? "");
  const [fixedCost, setFixedCost] = useState(node.fixedCost != null ? String(node.fixedCost) : "");
  /** One answer, three ways, derived from what the node already is: a flat
   * price makes it an "other", kit makes it a tool, everything else is stock. */
  const [editKind, setEditKind] = useState<InventoryKind>(
    node.fixedCost != null
      ? "other"
      : (node.costBasis ?? defaultCostBasis(node.nodeType)) === "capital"
        ? "tool"
        : "material"
  );
  const [purchaseUrl, setPurchaseUrl] = useState(node.purchaseUrl ?? "");

  // Every field above is seeded from the node once. The workspace remounts
  // this panel when the selection changes (key={node.id}), which resets the
  // form without an effect that fights whatever somebody is halfway through
  // typing.

  // Schedule row.
  const [scheduledFor, setScheduledFor] = useState(node.scheduledFor ?? "");
  const [recurrence, setRecurrence] = useState<Recurrence>(node.recurrence);
  const [interval, setInterval] = useState(String(node.recurrenceInterval || 1));

  // Breakdown row.
  const [needTitle, setNeedTitle] = useState("");
  const [needType, setNeedType] = useState<NodeType>("material");
  const [needRelationship, setNeedRelationship] = useState<RelationshipType>("requires");
  const [pickedKey, setPickedKey] = useState("");
  const [earnTitle, setEarnTitle] = useState("");
  const [earnPickedId, setEarnPickedId] = useState("");
  const [earnValue, setEarnValue] = useState("");
  const [earnCount, setEarnCount] = useState("");
  const [needQuantity, setNeedQuantity] = useState("");
  const [needUnit, setNeedUnit] = useState("each");
  /** Where a brand-new input should land: one of the inventory lists, or
   * nowhere, for the things that are not stock — an hour, a permit, a
   * process. */
  const [newIn, setNewIn] = useState<InventoryGroup | "none">("materials");
  const [feeAmount, setFeeAmount] = useState("");
  /** What a brand-new, non-inventory input is. The same three answers used
   * everywhere else, so nothing has to be said twice in two vocabularies. */
  const [needKind, setNeedKind] = useState<InventoryKind>("material");

  const neighbours = useMemo(() => neighboursOf(graph, node.id), [graph, node.id]);
  /**
   * Which way a connection actually runs, from where we are standing.
   *
   * Not the direction the edge is stored in. "Door hangers require
   * cardstock" is stored hangers → cardstock because that is the order the
   * words go in, but the cardstock goes into the hangers — so on the
   * hangers' panel it belongs with the things coming in, next to the arrow
   * that already points that way on the graph.
   *
   * Stored direction, flipped for the relationships whose flow runs against
   * their wording. The same rule the arrowheads use, so a list and a picture
   * of the same connection can never say opposite things.
   */
  const flowsOut = (n: Neighbour) =>
    n.outgoing !== (relationshipDef(n.edge.relationshipType).flowReversed === true);

  const outgoing = neighbours.filter(flowsOut);
  const incoming = neighbours.filter((n) => !flowsOut(n));

  // Suggested while typing a requirement, so the printer gets connected twice
  // rather than entered twice.
  const suggestions = useMemo(
    () =>
      needTitle.trim().length < 2
        ? []
        : findSimilarNodes(
            graph.nodes.filter((n) => n.id !== node.id),
            needTitle,
            4
          ),
    [graph.nodes, needTitle, node.id]
  );

  /**
   * Things in the graph that are not inventory items — design time, a print
   * run, a permit. Anything that is an inventory item is offered under its
   * own inventory group instead, so nothing appears in the list twice.
   */
  const graphOnly = useMemo(
    () =>
      graph.nodes
        .filter(
          (n) =>
            n.id !== node.id &&
            n.nodeType !== "idea" &&
            n.status !== "archived" &&
            !n.materialId &&
            !n.toolId
        )
        .sort((a, b) => a.title.localeCompare(b.title)),
    [graph.nodes, node.id]
  );

  /** Which inventory items already have a node, so picking one connects to
   * what is there rather than making a second copy of it. */
  const nodeByInventory = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graph.nodes) {
      if (n.materialId) map.set(`material:${n.materialId}`, n);
      if (n.toolId) map.set(`tool:${n.toolId}`, n);
    }
    return map;
  }, [graph.nodes]);

  /** All of inventory, in the same four lists the Inventory page uses. */
  const inventoryGroups = useMemo(
    () =>
      INVENTORY_GROUPS.map((group) => ({
        ...group,
        items: materials.filter((m) => m.group === group.value),
      })).filter((group) => group.items.length > 0),
    [materials]
  );

  /** Whichever list was picked from, flattened so the form below does not
   * have to care which. */
  const picked = useMemo(() => {
    const separator = pickedKey.indexOf(":");
    if (separator < 0) return null;
    const kind = pickedKey.slice(0, separator);
    const id = pickedKey.slice(separator + 1);

    if (kind === "node") {
      const found = graphOnly.find((r) => r.id === id);
      return found
        ? {
            kind: "node" as const,
            id: found.id,
            title: found.title,
            unit: found.unit,
            unitLabel: unitDef(found.unit).label.replace(/^per /, ""),
            unitCost: found.estimatedCost,
          }
        : null;
    }

    const found = materials.find((m) => m.kind === kind && m.id === id);
    return found
      ? {
          kind: found.kind,
          id: found.id,
          title: found.name,
          unit: found.unit,
          unitLabel: found.unit,
          unitCost: found.costPerUnit,
        }
      : null;
  }, [pickedKey, graphOnly, materials]);

  /**
   * How the thing being added is charged, worked out from what it is rather
   * than asked again. A tool is kit, a material is used up, and something
   * already in the graph has been answered for.
   */
  const needBasis: "consumable" | "capital" =
    picked?.kind === "tool"
      ? "capital"
      : picked?.kind === "material"
        ? "consumable"
        : newIn === "none"
          ? basisFor(needKind)
          : defaultCostBasis(needType);

  /** Only worth asking when a node is about to be made. Something already in
   * the graph has already been answered for. */
  const willCreateNode =
    !picked || (picked.kind !== "node" && !nodeByInventory.has(`${picked.kind}:${picked.id}`));

  /**
   * The node behind whatever was picked.
   *
   * An inventory item that is already in the graph is picked by its inventory
   * id, not its node id — so without this the app would forget it knows how
   * much one sheet does, in exactly the case where it does know.
   */
  const pickedNode = useMemo(() => {
    if (!picked) return null;
    if (picked.kind === "node") return graph.nodes.find((n) => n.id === picked.id) ?? null;
    return nodeByInventory.get(`${picked.kind}:${picked.id}`) ?? null;
  }, [picked, graph.nodes, nodeByInventory]);

  /** How many a run needs, where the idea says what a run makes and the input
   * says what one of it does. */
  const suggestion = useMemo(
    () => (pickedNode ? suggestedQuantity(node, pickedNode) : null),
    [node, pickedNode]
  );

  // What the line about to be added would come to, shown before it is added
  // rather than after — that is when somebody can still change their mind.
  const lineTotal = useMemo(() => {
    const quantity = Number(needQuantity) || 0;
    if (!quantity || picked?.unitCost == null) return null;
    return quantity * picked.unitCost;
  }, [needQuantity, picked]);

  /**
   * The sequence, and everything else that hangs off this node.
   *
   * A breakdown says what something is made of. It does not say what happens
   * first, and for anything somebody has to actually carry out, that is the
   * part they need.
   */
  const steps = useMemo(
    () =>
      neighbours
        .filter((n) => n.edge.stepOrder != null)
        .sort((a, b) => (a.edge.stepOrder ?? 0) - (b.edge.stepOrder ?? 0)),
    [neighbours]
  );

  /** Anything touching this node that is not in the sequence yet — either
   * direction. A step that feeds this thing points into it now, and leaving
   * those out meant half of what happens could never be put in order. */
  const notSteps = useMemo(() => neighbours.filter((n) => n.edge.stepOrder == null), [neighbours]);

  const stepIds = useMemo(() => steps.map((s) => s.edge.id), [steps]);

  const cost = useMemo(() => costOf(graph, node.id), [graph, node.id]);
  const payback = useMemo(() => paybackOf(graph, node.id), [graph, node.id]);

  /** Ways of earning that already exist somewhere in the graph. Attaching a
   * proven one beats inventing a second copy of it. */
  const earners = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.nodeType === "revenue_source" && n.id !== node.id && n.status !== "archived")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [graph.nodes, node.id]
  );

  const earnPicked = useMemo(
    () => earners.find((e) => e.id === earnPickedId) ?? null,
    [earners, earnPickedId]
  );

  const def = nodeTypeDef(node.nodeType);
  const today = todayKey();

  /** How more than one of a unit reads, using whatever this business calls
   * it. Falls back to the name itself rather than inventing a plural. */
  const unitPlural = (unit: string) =>
    units.find((u) => u.value === unit)?.plural ?? unitDef(unit).label.replace(/^per /, "");

  /** "$89 each" rather than "$89 per each". */
  const perUnit = (amount: number, unit: string) =>
    unit === "each" ? `${money(amount)} each` : `${money(amount)} per ${unit}`;

  /** Connects something just added to Inventory, without making the person
   * find it again in a list they were not looking at. */
  function connectNewInventory(item: {
    id: string;
    name: string;
    table: "material" | "tool";
    kind: InventoryKind;
  }) {
    run(async () => {
      const result = await addRequirement({
        nodeId: node.id,
        inventory: {
          kind: item.table,
          id: item.id,
          name: item.name,
          unit: item.table === "tool" ? "each" : needUnit,
        },
        relationshipType: needRelationship,
        quantity: needQuantity ? Number(needQuantity) : null,
        // Derived from what they already said it was, not asked again.
        costBasis: basisFor(item.kind),
      });
      if (result.ok) setNeedQuantity("");
      return result;
    });
  }

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    start(async () => {
      const result = await action();
      setMessage(result.message ?? (result.ok ? "Saved." : "That didn't work."));
      if (result.ok) onChanged();
    });
  }

  /**
   * How much of it, and how it hangs off this node.
   *
   * Rendered in one of two places: under the picker when connecting something
   * that already exists, and above the Inventory form when adding something
   * new — because that form's own button is what saves it, and the numbers it
   * will use should be in front of somebody before they press it.
   */
  const CONNECTION_FIELDS = (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">How it connects</Label>
              <Select value={needRelationship} onValueChange={(v) => setNeedRelationship(v as RelationshipType)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_TYPES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">
                How many {unitPlural(picked ? picked.unit : needUnit)}
              </Label>
              <Input
                value={needQuantity}
                inputMode="decimal"
                placeholder="2000"
                onChange={(e) => setNeedQuantity(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
  );

  return (
    <div className="rounded-xl border border-white/60 bg-card/70 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className="mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-900"
            style={{ backgroundColor: def.color }}
          >
            {def.label}
          </span>
          <h2 className="truncate text-lg font-bold">{node.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-sm text-muted-foreground">
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onFocus}>
          Local graph
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
          {editing ? "Stop editing" : "Edit"}
        </Button>
        {canDelete && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete "${node.title}" and every connection to it?`)) return;
              run(async () => {
                const result = await deleteNode(node.id);
                if (result.ok) onClose();
                return result;
              });
            }}
          >
            Delete
          </Button>
        )}
      </div>

      {message && <p className="mb-3 text-xs text-muted-foreground">{message}</p>}

      {editing ? (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Type</Label>
              <TypeSelect value={nodeType} onChange={setNodeType} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as NodeStatus)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NODE_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">What it is</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Importance 1–5</Label>
              <Input
                value={importance}
                inputMode="numeric"
                onChange={(e) => setImportance(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Tags, comma separated</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">One of it is</Label>
            <UnitSelect value={unit} units={units} onChange={setUnit} onAdded={onChanged} />
            <p className="text-[11px] text-muted-foreground">
              What a quantity of it means. An hour or a day makes it time rather than materials. The
              price is not set here — it comes from Inventory, so there is only ever one of it.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">What is it?</Label>
            <InventoryKindChoice value={editKind} onChange={setEditKind} />
          </div>

          {node.nodeType === "idea" ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">One run makes</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={runSize}
                  inputMode="decimal"
                  placeholder="2000"
                  onChange={(e) => setRunSize(e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  value={runUnit}
                  placeholder="hangers"
                  onChange={(e) => setRunUnit(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Say this and the app works out how much of each input a run needs, instead of somebody
                doing the sum in their head every time.
              </p>
            </div>
          ) : (
            <>
              {editKind !== "other" && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">One {unitDef(node.unit).label.replace(/^per /, "")} does</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={outputPerUnit}
                    inputMode="decimal"
                    placeholder="100"
                    onChange={(e) => setOutputPerUnit(e.target.value)}
                    className="h-9 text-sm"
                  />
                  <Input
                    value={outputUnit}
                    placeholder="sq ft"
                    onChange={(e) => setOutputUnit(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  A bag covers a hundred square feet; a sheet makes one hanger. Matched against what a run
                  makes, so the quantity works itself out.
                </p>
              </div>
              )}
              {editKind === "other" && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">What it costs</Label>
                  <Input
                    value={fixedCost}
                    inputMode="decimal"
                    placeholder="450"
                    onChange={(e) => setFixedCost(e.target.value)}
                    className="h-9 text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    A flat price, charged once per run whatever the quantity, and counted apart from
                    materials and hours.
                  </p>
                </div>
              )}
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Where you buy it</Label>
            <Input
              value={purchaseUrl}
              inputMode="url"
              placeholder="uline.com/…"
              onChange={(e) => setPurchaseUrl(e.target.value)}
              className="h-9 text-sm"
              disabled={node.materialId != null}
            />
            {node.materialId != null && (
              <p className="text-[11px] text-muted-foreground">
                Comes from the linked material — change it in Inventory.
              </p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() =>
                updateNode(node.id, {
                  title,
                  nodeType,
                  status,
                  description,
                  notes,
                  importance: importance ? Number(importance) : null,
                  unit,
                  costBasis: editKind === "other" ? null : basisFor(editKind),
                  runSize: runSize ? Number(runSize) : null,
                  runUnit: runUnit || null,
                  outputPerUnit: outputPerUnit ? Number(outputPerUnit) : null,
                  outputUnit: outputUnit || null,
                  fixedCost: editKind === "other" && fixedCost ? Number(fixedCost) : null,
                  purchaseUrl: purchaseUrl || null,
                  tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                })
              )
            }
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <div className="mb-4 space-y-1 text-sm">
          {node.description && <p>{node.description}</p>}
          {node.notes && <p className="text-muted-foreground">{node.notes}</p>}
          <p className="text-xs text-muted-foreground">
            {NODE_STATUSES.find((s) => s.value === node.status)?.label ?? node.status}
            {node.estimatedCost != null
              ? ` · ${money(node.estimatedCost)} ${unitDef(node.unit).label}`
              : ""}
            {node.fixedCost != null ? ` · ${money(node.fixedCost)} flat` : ""}
            {node.nodeType !== "idea" && node.fixedCost == null
              ? isCapital(node)
                ? " · bought once, kept"
                : " · bought again each run"
              : ""}
            {node.runSize != null ? ` · one run makes ${node.runSize} ${node.runUnit ?? ""}`.trimEnd() : ""}
            {node.outputPerUnit != null
              ? ` · one does ${node.outputPerUnit} ${node.outputUnit ?? ""}`.trimEnd()
              : ""}
            {node.importance ? ` · importance ${node.importance}/5` : ""}
            {node.tags.length > 0 ? ` · ${node.tags.join(", ")}` : ""}
          </p>
        </div>
      )}


      <Section title="When does this happen?">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3">
          {node.scheduledFor ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{describeDue(node.scheduledFor, today)}</span>
              <span className="text-xs text-muted-foreground">
                {node.scheduledFor} · {describeRecurrence(node.recurrence, node.recurrenceInterval)}
              </span>
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                disabled={pending}
                onClick={() => run(() => markNodeDone(node.id))}
              >
                {pending ? "…" : "Mark done"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not scheduled. An idea with no date is a note — give it one and it starts pulling its
              requirements along with it.
            </p>
          )}

          {(node.lastDoneAt || node.timesDone > 0) && (
            <p className="text-[11px] text-muted-foreground">
              Done {node.timesDone} time{node.timesDone === 1 ? "" : "s"}
              {node.lastDoneAt ? `, last on ${node.lastDoneAt}` : ""}.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Next date</Label>
              <Input
                type="date"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Repeats</Label>
              <Select value={recurrence} onValueChange={(v) => setRecurrence(v as Recurrence)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECURRENCES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {recurrence !== "none" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Every how many? ({describeRecurrence(recurrence, Number(interval) || 1)})</Label>
              <Input
                value={interval}
                inputMode="numeric"
                onChange={(e) => setInterval(e.target.value)}
                className="h-9 w-24 text-sm"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  scheduleNode(node.id, {
                    scheduledFor: scheduledFor || null,
                    recurrence,
                    recurrenceInterval: Number(interval) || 1,
                  })
                )
              }
            >
              {pending ? "Saving…" : "Save schedule"}
            </Button>
            {node.scheduledFor && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setScheduledFor("");
                  setRecurrence("none");
                  run(() => scheduleNode(node.id, { scheduledFor: null, recurrence: "none" }));
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Section>

      <Section title="What does this physically require?">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-3">
          {/* What this node itself is, before what it needs. An input that is
              a real thing in Inventory carries the real price; one that is
              not carries no price at all, which is a more useful thing to
              know than a number somebody guessed a year ago. */}
          {node.nodeType !== "idea" && (
            <div className="flex flex-col gap-1.5 border-b border-border/60 pb-3">
              {node.materialId && node.materialName ? (
                <>
                  <p className="text-sm">
                    This is <span className="font-medium">{node.materialName}</span> in Inventory.
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {node.estimatedCost != null
                      ? `${money(node.estimatedCost)} ${unitDef(node.unit).label}`
                      : "No price on it in Inventory yet"}
                    {node.stockOnHand != null ? ` · ${node.stockOnHand} on hand` : ""}
                    {node.onOrder ? " · on order" : ""}
                  </p>
                  {node.stockOnHand != null &&
                    node.reorderThreshold != null &&
                    node.stockOnHand <= node.reorderThreshold &&
                    !node.onOrder && (
                      <p className="text-[11px] font-medium text-amber-700">
                        Down to the reorder point — order before the next run needs it.
                      </p>
                    )}
                  <div className="flex flex-wrap gap-2">
                    <Link href="/admin/tools" className="rounded-md border border-border px-2 py-1 text-xs">
                      Open in Inventory
                    </Link>
                    {node.purchaseUrl && (
                      <a
                        href={node.purchaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-border px-2 py-1 text-xs"
                      >
                        Buy at {describePurchaseUrl(node.purchaseUrl)}
                      </a>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => linkNodeToMaterial(node.id, null))}
                    >
                      Unlink
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Not in Inventory, so it has no cost. Prices come from the real thing — link it and
                    every total that depends on it works itself out.
                  </p>
                  <Select
                    value=""
                    onValueChange={(v) => {
                      const separator = v.indexOf(":");
                      const kind = v.slice(0, separator) as "material" | "tool";
                      run(() => linkNodeToMaterial(node.id, { kind, id: v.slice(separator + 1) }));
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Link to an inventory item…" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[calc(100vw-2.5rem)]">
                      {inventoryGroups.map((group) => (
                        <div key={group.value}>
                          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                            {group.label}
                          </p>
                          {group.items.map((m) => (
                            <SelectItem key={`${m.kind}:${m.id}`} value={`${m.kind}:${m.id}`}>
                              <span className="block truncate">{m.name}</span>
                              {m.costPerUnit != null && (
                                <span className="block text-[11px] text-muted-foreground">
                                  {perUnit(m.costPerUnit, m.unit)}
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                  {materials.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Nothing in Inventory yet.{" "}
                      <Link href="/admin/tools" className="underline">
                        Add it there
                      </Link>{" "}
                      and it becomes linkable here.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* One list, two sources. Something already in the graph, or
              something in Inventory that is not in the graph yet — picking
              the second makes the node and the link in one go, so a material
              can never end up here twice with two prices. */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">What it needs</Label>
            <Select
              value={pickedKey}
              onValueChange={(v) => {
                setPickedKey(v);
                setNeedTitle("");
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Pick an input…" />
              </SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2.5rem)]">
                {inventoryGroups.map((group) => (
                  <div key={group.value}>
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </p>
                    {group.items.map((m) => {
                      const already = nodeByInventory.get(`${m.kind}:${m.id}`);
                      return (
                        <SelectItem key={`${m.kind}:${m.id}`} value={`${m.kind}:${m.id}`}>
                          <span className="block truncate">{m.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {m.costPerUnit != null ? perUnit(m.costPerUnit, m.unit) : "no price yet"}
                            {already ? " · already in the graph" : ""}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </div>
                ))}
                {graphOnly.length > 0 && (
                  <div>
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      In the graph only
                    </p>
                    {graphOnly.map((r) => (
                      <SelectItem key={r.id} value={`node:${r.id}`}>
                        <span className="block truncate">{r.title}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          not in Inventory, so no price
                        </span>
                      </SelectItem>
                    ))}
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {picked ? (
            <p className="text-[11px] text-muted-foreground">
              {picked.title}
              {picked.unitCost != null
                ? ` · ${money(picked.unitCost)} per ${picked.unitLabel}`
                : " · no price on it yet"}
              {" · "}
              <button type="button" className="underline" onClick={() => setPickedKey("")}>
                pick something else
              </button>
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-muted-foreground">or add something new</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              {/* Adding stock here is the Inventory form, not a smaller copy
                  of it. A second, simpler way to add a material is how you
                  end up with half your inventory missing its storage
                  location and its reorder point. */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Where it belongs</Label>
                <Select value={newIn} onValueChange={(v) => setNewIn(v as InventoryGroup | "none")}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVENTORY_GROUPS.map((group) => (
                      <SelectItem key={group.value} value={group.value}>
                        Inventory — {group.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="none">Not inventory (time, a permit, a process)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {newIn === "none" ? (
                <>
                  <Input
                    value={needTitle}
                    onChange={(e) => setNeedTitle(e.target.value)}
                    placeholder="Design time, a permit, somebody's Saturday…"
                    className="h-9 text-sm"
                  />
                  {suggestions.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <p className="text-[11px] text-muted-foreground">
                        Already in the graph — use one of these instead:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            disabled={pending}
                            className="rounded-full border border-border px-2 py-1 text-xs"
                            onClick={() => {
                              setPickedKey(`node:${s.id}`);
                              setNeedTitle("");
                            }}
                          >
                            <span
                              className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                              style={{ backgroundColor: nodeTypeDef(s.nodeType).color }}
                            />
                            {s.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">What kind of thing</Label>
                      <TypeSelect value={needType} onChange={setNeedType} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">One of it is</Label>
                      <UnitSelect value={needUnit} units={units} onChange={setNeedUnit} onAdded={onChanged} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">What is it?</Label>
                    <InventoryKindChoice value={needKind} onChange={setNeedKind} />
                  </div>
                  {needKind === "other" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">What it costs</Label>
                      <Input
                        value={feeAmount}
                        inputMode="decimal"
                        placeholder="450"
                        onChange={(e) => setFeeAmount(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      It will have no cost until somebody links it to Inventory — hours included, if you
                      keep a rate in there.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-2">
                  {CONNECTION_FIELDS}
                  <p className="text-[11px] text-muted-foreground">
                    Goes straight into Inventory under{" "}
                    {INVENTORY_GROUPS.find((g) => g.value === newIn)?.label}, and connects to{" "}
                    {node.title} on the terms above.
                  </p>
                  <InventoryAddForm
                    key={newIn}
                    group={newIn as InventoryGroup}
                    storageLocations={storageLocations}
                    availableKits={availableKits}
                    onCreated={connectNewInventory}
                  />
                </div>
              )}
            </>
          )}

          {(picked || newIn === "none") && CONNECTION_FIELDS}
          {suggestion != null && String(suggestion) !== needQuantity && (
            <p className="text-[11px] text-muted-foreground">
              A run of {node.runSize} {node.runUnit} needs{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setNeedQuantity(String(suggestion))}
              >
                {suggestion.toLocaleString()} {picked ? unitPlural(picked.unit) : ""}
              </button>
              .
            </p>
          )}

          {lineTotal != null && (
            <p className="text-[11px] text-muted-foreground">That line comes to {money(lineTotal)}.</p>
          )}

          {/* The Inventory form has its own button and does the connecting
              itself, so a second one here would be a button that does
              nothing. */}
          {(picked || newIn === "none") && (
            <Button
              type="button"
              size="sm"
              disabled={pending || (!picked && needTitle.trim().length === 0)}
              onClick={() =>
                run(async () => {
                  const result = await addRequirement({
                    nodeId: node.id,
                    existingId: picked?.kind === "node" ? picked.id : undefined,
                    inventory:
                      picked && picked.kind !== "node"
                        ? { kind: picked.kind, id: picked.id, name: picked.title, unit: picked.unit }
                        : undefined,
                    title: picked ? undefined : needTitle,
                    nodeType: picked ? undefined : needKind === "other" ? "service" : needType,
                    unit: picked ? undefined : needUnit,
                    fixedCost:
                      !picked && needKind === "other" && newIn === "none" && feeAmount
                        ? Number(feeAmount)
                        : null,
                    relationshipType: needRelationship,
                    quantity: needQuantity ? Number(needQuantity) : null,
                    costBasis: willCreateNode ? needBasis : undefined,
                  });
                  if (result.ok) {
                    setNeedTitle("");
                    setPickedKey("");
                    setNeedQuantity("");
                    setFeeAmount("");
                  }
                  return result;
                })
              }
            >
              {pending ? "Adding…" : picked ? `Use ${picked.title}` : "Add it"}
            </Button>
          )}
        </div>
      </Section>


      {(cost.lines.length > 0 || node.estimatedCost != null) && (
        <Section title="What this costs">
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <Figure label="Materials" value={money(cost.materials)} />
              <Figure label="Time" value={formatHours(cost.hours)} hint={money(cost.labour)} />
              <Figure label="Paid out" value={money(cost.services)} />
              <Figure label="Per run" value={money(cost.total)} strong />
            </div>
            {cost.serviceItems.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Flat prices: {cost.serviceItems.map((n) => n.title).join(", ")} — charged once a run
                whatever the quantity.
              </p>
            )}
            {cost.capital > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Plus {money(cost.capital)} of kit — {cost.capitalItems.map((n) => n.title).join(", ")} —
                bought once, not once per run.
              </p>
            )}
            {cost.unpriced.length > 0 && (
              <p className="mt-2 text-[11px] text-amber-700">
                No price yet on {cost.unpriced.map((n) => n.title).join(", ")} — the total is short by
                whatever those cost.
              </p>
            )}
            {cost.lines.some((l) => l.depth > 0) && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Includes what its own requirements need, all the way down.
              </p>
            )}
          </div>
        </Section>
      )}

      {node.nodeType === "idea" && (
        <Section title="What this earns">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3">
            {payback.lines.length > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Figure label="Earns" value={money(payback.revenue)} />
                  <Figure label="Costs" value={money(payback.cost.total)} />
                  <Figure
                    label={payback.net >= 0 ? "Clears" : "Short by"}
                    value={money(Math.abs(payback.net))}
                    strong
                  />
                </div>
                <ul className="flex flex-col gap-1">
                  {payback.lines.map((line) => (
                    <li key={line.node.id} className="text-[11px] text-muted-foreground">
                      {line.quantity} × {line.node.title}
                      {line.unitValue > 0 ? ` at ${money(line.unitValue)} = ${money(line.amount)}` : " — no value on it yet"}
                    </li>
                  ))}
                </ul>
                {payback.coversItself && (
                  <p className="text-[11px] font-medium text-emerald-700">This one pays for itself.</p>
                )}
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Nothing earns from this yet. A flyer is paper going through six hundred doors — and paper
                going through six hundred doors has advertising space on it. Worth asking before it goes
                out.
              </p>
            )}

            {earners.length > 0 && (
              <Select value={earnPickedId} onValueChange={(v) => { setEarnPickedId(v); setEarnTitle(""); }}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Use a way that already earns…" />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2.5rem)]">
                  {earners.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      <span className="block truncate">{e.title}</span>
                      {e.potentialValue != null && (
                        <span className="block text-[11px] text-muted-foreground">
                          {money(e.potentialValue)} each
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {!earnPicked && (
              <>
                <Input
                  value={earnTitle}
                  onChange={(e) => setEarnTitle(e.target.value)}
                  placeholder="Ad spot on the flyer, sponsor logo, referral fee…"
                  className="h-9 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Worth each</Label>
                    <Input
                      value={earnValue}
                      inputMode="decimal"
                      placeholder="75"
                      onChange={(e) => setEarnValue(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">How many</Label>
                    <Input
                      value={earnCount}
                      inputMode="decimal"
                      placeholder="6"
                      onChange={(e) => setEarnCount(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              </>
            )}

            {earnPicked && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">How many {earnPicked.title.toLowerCase()}</Label>
                <Input
                  value={earnCount}
                  inputMode="decimal"
                  placeholder="6"
                  onChange={(e) => setEarnCount(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            )}

            <Button
              type="button"
              size="sm"
              disabled={pending || (!earnPicked && earnTitle.trim().length === 0)}
              onClick={() =>
                run(async () => {
                  const result = await addEarner({
                    nodeId: node.id,
                    existingId: earnPicked?.id,
                    title: earnPicked ? undefined : earnTitle,
                    unitValue: earnValue ? Number(earnValue) : null,
                    quantity: earnCount ? Number(earnCount) : null,
                  });
                  if (result.ok) {
                    setEarnTitle("");
                    setEarnPickedId("");
                    setEarnValue("");
                    setEarnCount("");
                  }
                  return result;
                })
              }
            >
              {pending ? "Adding…" : earnPicked ? `Earn through ${earnPicked.title}` : "Add a way it pays"}
            </Button>
          </div>
        </Section>
      )}

      {(steps.length > 0 || notSteps.length > 0) && (
        <Section title={steps.length > 0 ? `Steps, in order (${steps.length})` : "Put it in order"}>
          <div className="flex flex-col gap-2">
            {steps.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing is a step yet. Add one below and this becomes a sequence somebody can follow
                rather than a pile of parts.
              </p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {steps.map((step, index) => (
                  <ConnectionRow
                    key={step.edge.id}
                    owner={node}
                    node={step.node}
                    edge={step.edge}
                    outgoing={step.outgoing}
                    pending={pending}
                    onSelect={onSelect}
                    onRemove={(edgeId) => run(() => deleteRelationship(edgeId))}
                    onQuantity={(edgeId, quantity) =>
                      run(() => updateRelationship(edgeId, { quantity }))
                    }
                    onRelationship={(edgeId, relationshipType) =>
                      run(() => updateRelationship(edgeId, { relationshipType }))
                    }
                    step={{
                      number: index + 1,
                      first: index === 0,
                      last: index === steps.length - 1,
                      onUp: () => run(() => reorderSteps(node.id, move(stepIds, index, -1), stepIds)),
                      onDown: () => run(() => reorderSteps(node.id, move(stepIds, index, 1), stepIds)),
                      onOut: () =>
                        run(() =>
                          reorderSteps(
                            node.id,
                            stepIds.filter((id) => id !== step.edge.id),
                            stepIds
                          )
                        ),
                    }}
                  />
                ))}
              </ol>
            )}

            {notSteps.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Add one of these to the sequence:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {notSteps.map(({ node: target, edge, outgoing: points }) => (
                    <button
                      key={edge.id}
                      type="button"
                      disabled={pending}
                      className="rounded-full border border-border px-2 py-1 text-xs"
                      onClick={() => run(() => reorderSteps(node.id, [...stepIds, edge.id], stepIds))}
                      title={
                        points
                          ? `${node.title} ${relationshipDef(edge.relationshipType).label} ${target.title}`
                          : `${target.title} ${relationshipDef(edge.relationshipType).label} ${node.title}`
                      }
                    >
                      <span
                        className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ backgroundColor: nodeTypeDef(target.nodeType).color }}
                      />
                      {target.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title={`Goes out of this (${outgoing.length})`}>
        <ConnectionList
          owner={node}
          items={outgoing}
          pending={pending}
          onSelect={onSelect}
          onRemove={(edgeId) => run(() => deleteRelationship(edgeId))}
          onQuantity={(edgeId, quantity) => run(() => updateRelationship(edgeId, { quantity }))}
          onRelationship={(edgeId, relationshipType) =>
            run(() => updateRelationship(edgeId, { relationshipType }))
          }
          direction="out"
        />
      </Section>

      <Section title={`Comes into this (${incoming.length})`}>
        <ConnectionList
          owner={node}
          items={incoming}
          pending={pending}
          onSelect={onSelect}
          onRemove={(edgeId) => run(() => deleteRelationship(edgeId))}
          onQuantity={(edgeId, quantity) => run(() => updateRelationship(edgeId, { quantity }))}
          onRelationship={(edgeId, relationshipType) =>
            run(() => updateRelationship(edgeId, { relationshipType }))
          }
          direction="in"
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function ConnectionList({
  owner,
  items,
  pending,
  direction,
  onSelect,
  onRemove,
  onQuantity,
  onRelationship,
}: {
  owner: GraphNode;
  items: ReturnType<typeof neighboursOf>;
  pending: boolean;
  direction: "in" | "out";
  onSelect: (id: string) => void;
  onRemove: (edgeId: string) => void;
  onQuantity: (edgeId: string, quantity: number | null) => void;
  onRelationship: (edgeId: string, relationshipType: RelationshipType) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {direction === "in"
          ? "Nothing goes into this yet. Break it down above and it stops being just an idea."
          : "Nothing comes out of this yet — no revenue, nothing it produces."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ node, edge, outgoing }) => (
        <ConnectionRow
          key={edge.id}
          owner={owner}
          node={node}
          edge={edge}
          outgoing={outgoing}
          pending={pending}
          onSelect={onSelect}
          onRemove={onRemove}
          onQuantity={onQuantity}
          onRelationship={onRelationship}
        />
      ))}
    </ul>
  );
}

/**
 * One connection, with how much of it this needs.
 *
 * Editable in both directions, on purpose. Looking at the cardstock, the
 * useful question is "how much of me goes into the door hangers" — and the
 * answer lives on the same edge whichever end you are standing at. Making it
 * editable only from the idea meant walking back round to the idea to fix a
 * number you were already looking at.
 */
function ConnectionRow({
  owner,
  node,
  edge,
  outgoing,
  pending,
  onSelect,
  onRemove,
  onQuantity,
  onRelationship,
  step,
}: {
  /** The node whose panel this row is on, so a run size can suggest a
   * quantity from this side too. */
  owner: GraphNode;
  node: GraphNode;
  edge: ReturnType<typeof neighboursOf>[number]["edge"];
  outgoing: boolean;
  pending: boolean;
  onSelect: (id: string) => void;
  onRemove: (edgeId: string) => void;
  onQuantity: (edgeId: string, quantity: number | null) => void;
  onRelationship: (edgeId: string, relationshipType: RelationshipType) => void;
  /** Set when this row is a step in a sequence: its number, and the ways it
   * can move. A step is a connection like any other, so it is the same row
   * with the same editing rather than a second kind of row that drifts. */
  step?: {
    number: number;
    first: boolean;
    last: boolean;
    onUp: () => void;
    onDown: () => void;
    onOut: () => void;
  };
}) {
  const [draft, setDraft] = useState(edge.quantity != null ? String(edge.quantity) : "");
  const [editing, setEditing] = useState(false);
  const def = relationshipDef(edge.relationshipType);

  // Whichever end this row is on, the thing being consumed is the other one
  // when the edge points away, and this node when it points in.
  const consumed = outgoing ? node : owner;
  const maker = outgoing ? owner : node;
  const amount =
    edge.quantity != null && consumed.estimatedCost != null
      ? edge.quantity * consumed.estimatedCost
      : null;
  const suggestion = suggestedQuantity(maker, consumed);

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-2">
      <div className="flex items-center gap-2">
        {step ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold tabular-nums">
            {step.number}
          </span>
        ) : (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: nodeTypeDef(node.nodeType).color }}
          />
        )}
        <button type="button" onClick={() => onSelect(node.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm">{node.title}</span>
          <span className="block text-[11px] text-muted-foreground">
            {outgoing ? def.label : def.inverse}
            {edge.quantity != null ? ` · ${describeQuantity(edge.quantity, consumed.unit)}` : ""}
            {consumed.fixedCost != null
              ? ` · ${money(consumed.fixedCost)} flat`
              : amount != null
                ? ` · ${money(amount)}`
                : ""}
          </span>
        </button>
        {step && (
          <>
            <button
              type="button"
              disabled={pending || step.first}
              onClick={step.onUp}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] disabled:opacity-30"
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={pending || step.last}
              onClick={step.onDown}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] disabled:opacity-30"
              aria-label="Move down"
            >
              ↓
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="shrink-0 text-[11px] text-muted-foreground underline"
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing && (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              inputMode="decimal"
              placeholder={`How many ${unitDef(consumed.unit).label.replace(/^per /, "")}`}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 flex-1 text-xs"
            />
            <button
              type="button"
              disabled={pending || draft === (edge.quantity != null ? String(edge.quantity) : "")}
              onClick={() => onQuantity(edge.id, draft ? Number(draft) : null)}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] disabled:opacity-40"
            >
              Save
            </button>
          </div>

          {suggestion != null && String(suggestion) !== draft && (
            <p className="text-[11px] text-muted-foreground">
              A run of {maker.runSize} {maker.runUnit} needs{" "}
              <button type="button" className="underline" onClick={() => setDraft(String(suggestion))}>
                {suggestion.toLocaleString()}
              </button>
              .
            </p>
          )}

          <Select
            value={edge.relationshipType}
            onValueChange={(v) => onRelationship(edge.id, v as RelationshipType)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELATIONSHIP_TYPES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {outgoing ? r.label : r.inverse}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex flex-wrap gap-3">
            {step && (
              <button
                type="button"
                disabled={pending}
                onClick={step.onOut}
                className="text-[11px] text-muted-foreground underline"
              >
                Take it out of the sequence
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => onRemove(edge.id)}
              className="text-[11px] text-muted-foreground underline"
            >
              Remove this connection
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Figure({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${strong ? "text-base font-bold" : "text-sm font-medium"}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * What one of a thing is, including the ones this business invented.
 *
 * The last option adds a new one rather than sending somebody to a settings
 * screen: a unit is only ever needed at the moment you are typing the thing
 * that uses it, and a trip elsewhere to define "pallet" is a trip most people
 * do not take — they pick "each" and remember what they meant, which is the
 * same as not recording it.
 */
export function UnitSelect({
  value,
  units,
  onChange,
  onAdded,
}: {
  value: string;
  units: UnitOption[];
  onChange: (v: string) => void;
  onAdded?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [hours, setHours] = useState("");
  const [isTime, setIsTime] = useState(false);
  const [saving, startSaving] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  if (adding) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="pallet, scoop, thousand…"
          className="h-9 text-sm"
        />
        <label className="flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" checked={isTime} onChange={(e) => setIsTime(e.target.checked)} />
          It is a stretch of somebody&apos;s day
        </label>
        {isTime && (
          <div className="flex items-center gap-2">
            <Input
              value={hours}
              inputMode="decimal"
              placeholder="6"
              onChange={(e) => setHours(e.target.value)}
              className="h-9 w-20 text-sm"
            />
            <span className="text-[11px] text-muted-foreground">hours in one</span>
          </div>
        )}
        {problem && <p className="text-[11px] text-amber-700">{problem}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={saving || !name.trim()}
            onClick={() =>
              startSaving(async () => {
                const result = await addUnit({
                  name,
                  hours: isTime ? Number(hours) || 1 : null,
                });
                if (!result.ok) {
                  setProblem(result.message);
                  return;
                }
                onChange(name.trim().toLowerCase());
                setAdding(false);
                setName("");
                setHours("");
                setIsTime(false);
                setProblem(null);
                onAdded?.();
              })
            }
          >
            {saving ? "Adding…" : "Add unit"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === NEW_UNIT) setAdding(true);
        else onChange(v);
      }}
    >
      <SelectTrigger className="h-9 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-w-[calc(100vw-2.5rem)]">
        {units.map((u) => (
          <SelectItem key={u.value} value={u.value}>
            {u.label}
            {u.hours != null ? ` · ${u.hours} hr${u.hours === 1 ? "" : "s"}` : ""}
          </SelectItem>
        ))}
        <SelectItem value={NEW_UNIT}>+ Add a unit…</SelectItem>
      </SelectContent>
    </Select>
  );
}

const NEW_UNIT = "__new_unit__";

/** Twenty-six types is a lot for one list, so they come grouped. */
export function TypeSelect({ value, onChange }: { value: NodeType; onChange: (v: NodeType) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof NODE_TYPES>();
    for (const type of NODE_TYPES) {
      const list = map.get(type.group) ?? [];
      list.push(type);
      map.set(type.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <Select value={value} onValueChange={(v) => onChange(v as NodeType)}>
      <SelectTrigger className="h-9 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map(([group, types]) => (
          <div key={group}>
            <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">{group}</p>
            {types.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One row up or down, as a whole new order — the server is told the sequence
 * it should end up with rather than the nudge that got there. */
function move(ids: string[], index: number, delta: number): string[] {
  const next = [...ids];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
