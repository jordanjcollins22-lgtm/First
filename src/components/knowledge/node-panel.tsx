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
  addRequirement,
  deleteNode,
  deleteRelationship,
  updateNode,
} from "@/lib/actions/knowledge-graph-actions";

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

  // Every field above is seeded from the node once. The workspace remounts
  // this panel when the selection changes (key={node.id}), which resets the
  // form without an effect that fights whatever somebody is halfway through
  // typing.

  // Breakdown row.
  const [needTitle, setNeedTitle] = useState("");
  const [needType, setNeedType] = useState<NodeType>("material");
  const [needRelationship, setNeedRelationship] = useState<RelationshipType>("requires");

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

  const def = nodeTypeDef(node.nodeType);

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
            {node.importance ? ` · importance ${node.importance}/5` : ""}
            {node.tags.length > 0 ? ` · ${node.tags.join(", ")}` : ""}
          </p>
        </div>
      )}

      <Section title="What does this physically require?">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3">
          <Input
            value={needTitle}
            onChange={(e) => setNeedTitle(e.target.value)}
            placeholder="Cardstock, printer, toner, four hours of design…"
            className="h-9 text-sm"
          />
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] text-muted-foreground">Already in the graph — connect to one of these:</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={pending}
                    className="rounded-full border border-border px-2 py-1 text-xs"
                    onClick={() =>
                      run(async () => {
                        const result = await addRequirement({
                          nodeId: node.id,
                          existingId: s.id,
                          relationshipType: needRelationship,
                        });
                        if (result.ok) setNeedTitle("");
                        return result;
                      })
                    }
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
            <TypeSelect value={needType} onChange={setNeedType} />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending || needTitle.trim().length === 0}
            onClick={() =>
              run(async () => {
                const result = await addRequirement({
                  nodeId: node.id,
                  title: needTitle,
                  nodeType: needType,
                  relationshipType: needRelationship,
                });
                if (result.ok) setNeedTitle("");
                return result;
              })
            }
          >
            {pending ? "Adding…" : "Add as a new node"}
          </Button>
        </div>
      </Section>

      <Section title={`Points out (${outgoing.length})`}>
        <ConnectionList
          items={outgoing}
          pending={pending}
          onSelect={onSelect}
          onRemove={(edgeId) => run(() => deleteRelationship(edgeId))}
          direction="out"
        />
      </Section>

      <Section title={`Points in (${incoming.length})`}>
        <ConnectionList
          items={incoming}
          pending={pending}
          onSelect={onSelect}
          onRemove={(edgeId) => run(() => deleteRelationship(edgeId))}
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
}: {
  items: ReturnType<typeof neighboursOf>;
  pending: boolean;
  direction: "in" | "out";
  onSelect: (id: string) => void;
  onRemove: (edgeId: string) => void;
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
      {items.map(({ node, edge, outgoing }) => {
        const def = relationshipDef(edge.relationshipType);
        return (
          <li key={edge.id} className="flex items-center gap-2 rounded-lg border border-border/60 p-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: nodeTypeDef(node.nodeType).color }}
            />
            <button type="button" onClick={() => onSelect(node.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm">{node.title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {outgoing ? def.label : def.inverse} · strength {edge.strength}
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
          </li>
        );
      })}
    </ul>
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
