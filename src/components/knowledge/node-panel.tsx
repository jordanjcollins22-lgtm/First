"use client";

import { useMemo, useState, useTransition } from "react";

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
  type NodeStatus,
  type NodeType,
  type RelationshipType,
} from "@/lib/knowledge-graph";
import {
  UNITS,
  costOf,
  describeQuantity,
  hours as formatHours,
  money,
  unitDef,
} from "@/lib/knowledge-cost";
import {
  addRequirement,
  deleteNode,
  deleteRelationship,
  markNodeDone,
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
  canDelete,
  onClose,
  onFocus,
  onSelect,
  onChanged,
}: {
  graph: Graph;
  node: GraphNode;
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
  const [unitCost, setUnitCost] = useState(node.estimatedCost != null ? String(node.estimatedCost) : "");
  const [unit, setUnit] = useState(node.unit);

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
  const [pickedId, setPickedId] = useState("");
  const [needQuantity, setNeedQuantity] = useState("");
  const [needCost, setNeedCost] = useState("");
  const [needUnit, setNeedUnit] = useState("each");

  const neighbours = useMemo(() => neighboursOf(graph, node.id), [graph, node.id]);
  const outgoing = neighbours.filter((n) => n.outgoing);
  const incoming = neighbours.filter((n) => !n.outgoing);

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
   * Everything already in the graph that could be an input, priced ones
   * first.
   *
   * Ideas are left out: an idea is a thing you have, not a thing you buy, and
   * a dropdown of every thought in the business is a dropdown nobody scrolls.
   */
  const reusable = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.id !== node.id && n.nodeType !== "idea" && n.status !== "archived")
        .sort(
          (a, b) =>
            Number(b.estimatedCost != null) - Number(a.estimatedCost != null) ||
            a.title.localeCompare(b.title)
        ),
    [graph.nodes, node.id]
  );

  const picked = useMemo(() => reusable.find((r) => r.id === pickedId) ?? null, [reusable, pickedId]);

  // What the line about to be added would come to, shown before it is added
  // rather than after — that is when somebody can still change their mind.
  const lineTotal = useMemo(() => {
    const quantity = Number(needQuantity) || 0;
    const rate = picked ? picked.estimatedCost : needCost ? Number(needCost) : null;
    if (!quantity || rate == null || Number.isNaN(rate)) return null;
    return quantity * rate;
  }, [needQuantity, needCost, picked]);

  const cost = useMemo(() => costOf(graph, node.id), [graph, node.id]);

  const def = nodeTypeDef(node.nodeType);
  const today = todayKey();

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    start(async () => {
      const result = await action();
      setMessage(result.message ?? (result.ok ? "Saved." : "That didn't work."));
      if (result.ok) onChanged();
    });
  }

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
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Cost of one</Label>
              <Input
                value={unitCost}
                inputMode="decimal"
                placeholder="0.12"
                onChange={(e) => setUnitCost(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">One of it is</Label>
              <UnitSelect value={unit} onChange={setUnit} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Priced per unit, so everything that needs it works its own total out. An hour or a day makes
            it time rather than materials.
          </p>
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
                  estimatedCost: unitCost ? Number(unitCost) : null,
                  unit,
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
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3">
          {/* The dropdown comes first on purpose. Once the cardstock exists
              and is priced, every idea after this one should be picking it,
              not typing it again — a second copy is a second price to keep
              up to date and a shared resource nobody can see. */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Use something already in the graph</Label>
            <Select
              value={pickedId}
              onValueChange={(v) => {
                setPickedId(v);
                setNeedTitle("");
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Pick an input…" />
              </SelectTrigger>
              <SelectContent>
                {reusable.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title}
                    {r.estimatedCost != null ? ` — ${money(r.estimatedCost)} ${unitDef(r.unit).label}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {picked ? (
            <p className="text-[11px] text-muted-foreground">
              {picked.title}
              {picked.estimatedCost != null
                ? ` · ${money(picked.estimatedCost)} ${unitDef(picked.unit).label}`
                : " · no price on it yet"}
              {" · "}
              <button type="button" className="underline" onClick={() => setPickedId("")}>
                pick something else
              </button>
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-muted-foreground">or add a new one</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Input
                value={needTitle}
                onChange={(e) => setNeedTitle(e.target.value)}
                placeholder="Cardstock, printer, toner, design time…"
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
                          setPickedId(s.id);
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
                  <Label className="text-xs">Cost of one</Label>
                  <Input
                    value={needCost}
                    inputMode="decimal"
                    placeholder="0.12"
                    onChange={(e) => setNeedCost(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">One of it is</Label>
                <UnitSelect value={needUnit} onChange={setNeedUnit} />
              </div>
            </>
          )}

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
                How many {picked ? unitDef(picked.unit).label.replace(/^per /, "") : unitDef(needUnit).label.replace(/^per /, "")}
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

          {lineTotal != null && (
            <p className="text-[11px] text-muted-foreground">That line comes to {money(lineTotal)}.</p>
          )}

          <Button
            type="button"
            size="sm"
            disabled={pending || (!picked && needTitle.trim().length === 0)}
            onClick={() =>
              run(async () => {
                const result = await addRequirement({
                  nodeId: node.id,
                  existingId: picked?.id,
                  title: picked ? undefined : needTitle,
                  nodeType: picked ? undefined : needType,
                  relationshipType: needRelationship,
                  quantity: needQuantity ? Number(needQuantity) : null,
                  unitCost: picked || !needCost ? null : Number(needCost),
                  unit: picked ? undefined : needUnit,
                });
                if (result.ok) {
                  setNeedTitle("");
                  setPickedId("");
                  setNeedQuantity("");
                  setNeedCost("");
                }
                return result;
              })
            }
          >
            {pending ? "Adding…" : picked ? `Use ${picked.title}` : "Add as a new node"}
          </Button>
        </div>
      </Section>

      {(cost.lines.length > 0 || node.estimatedCost != null) && (
        <Section title="What this costs">
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Figure label="Materials" value={money(cost.materials)} />
              <Figure label="Time" value={formatHours(cost.hours)} hint={money(cost.labour)} />
              <Figure label="Per run" value={money(cost.total)} strong />
            </div>
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

      <Section title={`Points out (${outgoing.length})`}>
        <ConnectionList
          items={outgoing}
          pending={pending}
          onSelect={onSelect}
          onRemove={(edgeId) => run(() => deleteRelationship(edgeId))}
          onQuantity={(edgeId, quantity) => run(() => updateRelationship(edgeId, { quantity }))}
          direction="out"
        />
      </Section>

      <Section title={`Points in (${incoming.length})`}>
        <ConnectionList
          items={incoming}
          pending={pending}
          onSelect={onSelect}
          onRemove={(edgeId) => run(() => deleteRelationship(edgeId))}
          onQuantity={(edgeId, quantity) => run(() => updateRelationship(edgeId, { quantity }))}
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
  items,
  pending,
  direction,
  onSelect,
  onRemove,
  onQuantity,
}: {
  items: ReturnType<typeof neighboursOf>;
  pending: boolean;
  direction: "in" | "out";
  onSelect: (id: string) => void;
  onRemove: (edgeId: string) => void;
  onQuantity: (edgeId: string, quantity: number | null) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {direction === "out"
          ? "Nothing yet. Break it down above and it stops being just an idea."
          : "Nothing points at this yet."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ node, edge, outgoing }) => (
        <ConnectionRow
          key={edge.id}
          node={node}
          edge={edge}
          outgoing={outgoing}
          pending={pending}
          onSelect={onSelect}
          onRemove={onRemove}
          onQuantity={onQuantity}
        />
      ))}
    </ul>
  );
}

/**
 * One connection, with how much of it this needs.
 *
 * The quantity is editable in place rather than behind an edit screen: it is
 * the number most likely to be wrong on the first pass, and the one somebody
 * corrects while looking at the total it produced.
 */
function ConnectionRow({
  node,
  edge,
  outgoing,
  pending,
  onSelect,
  onRemove,
  onQuantity,
}: {
  node: GraphNode;
  edge: ReturnType<typeof neighboursOf>[number]["edge"];
  outgoing: boolean;
  pending: boolean;
  onSelect: (id: string) => void;
  onRemove: (edgeId: string) => void;
  onQuantity: (edgeId: string, quantity: number | null) => void;
}) {
  const [draft, setDraft] = useState(edge.quantity != null ? String(edge.quantity) : "");
  const def = relationshipDef(edge.relationshipType);
  const amount = edge.quantity != null && node.estimatedCost != null
    ? edge.quantity * node.estimatedCost
    : null;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-2">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: nodeTypeDef(node.nodeType).color }}
        />
        <button type="button" onClick={() => onSelect(node.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm">{node.title}</span>
          <span className="block text-[11px] text-muted-foreground">
            {outgoing ? def.label : def.inverse}
            {edge.quantity != null ? ` · ${describeQuantity(edge.quantity, node.unit)}` : ""}
            {amount != null ? ` · ${money(amount)}` : ""}
          </span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onRemove(edge.id)}
          className="shrink-0 text-[11px] text-muted-foreground underline"
        >
          Remove
        </button>
      </div>

      {outgoing && (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            inputMode="decimal"
            placeholder={`How many ${unitDef(node.unit).label.replace(/^per /, "")}`}
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

/** What one of a thing is. Kept short and in the order somebody reaches for
 * them, with time at the top because that is the cost people forget. */
export function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UNITS.map((u) => (
          <SelectItem key={u.value} value={u.value}>
            {u.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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
