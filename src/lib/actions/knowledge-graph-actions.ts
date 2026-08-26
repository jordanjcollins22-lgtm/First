"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { RECURRENCES, advance, todayKey, type Recurrence } from "@/lib/knowledge-schedule";
import { UNITS } from "@/lib/knowledge-cost";
import { safePurchaseUrl } from "@/lib/purchase-url";
import {
  NODE_STATUSES,
  NODE_TYPES,
  RELATIONSHIP_TYPES,
  type NodeStatus,
  type NodeType,
  type RelationshipType,
} from "@/lib/knowledge-graph";

export type GraphResult = { ok: true; id?: string; message?: string } | { ok: false; message: string };

const PATH = "/knowledge-graph";

const VALID_TYPES = new Set(NODE_TYPES.map((t) => t.value as string));
const VALID_STATUSES = new Set(NODE_STATUSES.map((s) => s.value as string));
const VALID_RELATIONSHIPS = new Set(RELATIONSHIP_TYPES.map((r) => r.value as string));
const VALID_RECURRENCES = new Set(RECURRENCES.map((r) => r.value as string));
const VALID_UNITS = new Set(UNITS.map((u) => u.value));

export interface NodeInput {
  title: string;
  nodeType?: NodeType;
  status?: NodeStatus;
  description?: string;
  notes?: string;
  importance?: number | null;
  unit?: string;
  purchaseUrl?: string | null;
  /** The inventory item this is. Where the price comes from — the graph does
   * not keep one of its own. */
  materialId?: string | null;
  toolId?: string | null;
  potentialValue?: number | null;
  tags?: string[];
  positionX?: number | null;
  positionY?: number | null;
  scheduledFor?: string | null;
  recurrence?: Recurrence;
  recurrenceInterval?: number;
}

/**
 * Puts a thought in the graph.
 *
 * Everything except the title is optional and everything except the title has
 * a default, because the moment this asks for a form is the moment somebody
 * stops using it. A half-described idea in the graph beats a fully described
 * one in somebody's head, and the detail panel is there for later.
 */
export async function createNode(input: NodeInput): Promise<GraphResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const title = input.title.trim();
    if (!title) return { ok: false, message: "Give it a name." };

    const nodeType = input.nodeType && VALID_TYPES.has(input.nodeType) ? input.nodeType : "idea";
    const status = input.status && VALID_STATUSES.has(input.status) ? input.status : "idea";

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);

    const { data, error } = await supabase
      .from("knowledge_nodes")
      .insert({
        organization_id: organizationId,
        title,
        node_type: nodeType,
        status,
        description: input.description?.trim() || null,
        notes: input.notes?.trim() || null,
        importance: clampScale(input.importance),
        unit: validUnit(input.unit),
        material_id: input.materialId ?? null,
        tool_id: input.toolId ?? null,
        purchase_url: safePurchaseUrl(input.purchaseUrl),
        potential_value: numberOrNull(input.potentialValue),
        position_x: input.positionX ?? null,
        position_y: input.positionY ?? null,
        scheduled_for: dateOrNull(input.scheduledFor),
        recurrence: validRecurrence(input.recurrence),
        recurrence_interval: clampInterval(input.recurrenceInterval),
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (error) return { ok: false, message: describeDbError(error) };

    if (input.tags && input.tags.length > 0) {
      const tagged = await applyTags(data.id, organizationId, input.tags);
      if (!tagged.ok) return tagged;
    }

    revalidatePath(PATH);
    return { ok: true, id: data.id, message: `Added "${title}".` };
  } catch (err) {
    console.error("createNode failed:", err);
    return { ok: false, message: "Couldn't add that." };
  }
}

/**
 * Changes a node that already exists.
 *
 * Only the fields actually passed are written. A patch that touched every
 * column would let a panel that never loaded the notes field quietly erase
 * somebody's notes.
 */
export async function updateNode(id: string, patch: Partial<NodeInput>): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const update: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) return { ok: false, message: "Give it a name." };
      update.title = title;
    }
    if (patch.nodeType !== undefined && VALID_TYPES.has(patch.nodeType)) update.node_type = patch.nodeType;
    if (patch.status !== undefined && VALID_STATUSES.has(patch.status)) update.status = patch.status;
    if (patch.description !== undefined) update.description = patch.description.trim() || null;
    if (patch.notes !== undefined) update.notes = patch.notes.trim() || null;
    if (patch.importance !== undefined) update.importance = clampScale(patch.importance);
    if (patch.unit !== undefined) update.unit = validUnit(patch.unit);
    if (patch.purchaseUrl !== undefined) update.purchase_url = safePurchaseUrl(patch.purchaseUrl);
    if (patch.potentialValue !== undefined) update.potential_value = numberOrNull(patch.potentialValue);
    if (patch.scheduledFor !== undefined) update.scheduled_for = dateOrNull(patch.scheduledFor);
    if (patch.recurrence !== undefined) update.recurrence = validRecurrence(patch.recurrence);
    if (patch.recurrenceInterval !== undefined) {
      update.recurrence_interval = clampInterval(patch.recurrenceInterval);
    }

    const supabase = await createClient();

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("knowledge_nodes")
        .update(update as never)
        .eq("id", id);
      if (error) return { ok: false, message: describeDbError(error) };
    }

    if (patch.tags !== undefined) {
      const organizationId = await getCurrentOrganizationId();
      const tagged = await applyTags(id, organizationId, patch.tags, { replace: true });
      if (!tagged.ok) return tagged;
    }

    revalidatePath(PATH);
    return { ok: true, id, message: "Saved." };
  } catch (err) {
    console.error("updateNode failed:", err);
    return { ok: false, message: "Couldn't save that." };
  }
}

/**
 * Removes a node and, by cascade, every edge that touched it.
 *
 * Admin-only. Deleting a hub takes its relationships with it, which is a lot
 * of somebody's thinking to lose to a mis-tap on a phone.
 */
export async function deleteNode(id: string): Promise<GraphResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!profile.roles.includes("admin")) {
      return { ok: false, message: "Only an admin can delete from the graph." };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("knowledge_nodes").delete().eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return { ok: true, message: "Deleted." };
  } catch (err) {
    console.error("deleteNode failed:", err);
    return { ok: false, message: "Couldn't delete that." };
  }
}

/**
 * Draws a line between two nodes.
 *
 * The database refuses a self-edge and refuses the same edge twice; both are
 * turned into something a person can read rather than a constraint name.
 */
export async function createRelationship(input: {
  sourceId: string;
  targetId: string;
  relationshipType: RelationshipType;
  strength?: number;
  quantity?: number | null;
  notes?: string;
}): Promise<GraphResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    if (input.sourceId === input.targetId) return { ok: false, message: "A node can't connect to itself." };
    if (!VALID_RELATIONSHIPS.has(input.relationshipType)) {
      return { ok: false, message: "Pick how they're connected." };
    }

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);

    const { data, error } = await supabase
      .from("knowledge_relationships")
      .insert({
        organization_id: organizationId,
        source_node_id: input.sourceId,
        target_node_id: input.targetId,
        relationship_type: input.relationshipType,
        strength: clampScale(input.strength) ?? 3,
        quantity: quantityOrNull(input.quantity),
        notes: input.notes?.trim() || null,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") return { ok: false, message: "They're already connected that way." };
      return { ok: false, message: describeDbError(error) };
    }

    revalidatePath(PATH);
    return { ok: true, id: data.id, message: "Connected." };
  } catch (err) {
    console.error("createRelationship failed:", err);
    return { ok: false, message: "Couldn't connect those." };
  }
}

/**
 * The breakdown step: "what does this physically require?"
 *
 * One call rather than create-then-connect from the browser, because the
 * halfway state — a printer in the graph that nothing points at — is exactly
 * the mess this feature exists to avoid, and two round trips from a phone on
 * a driveway is how you get one.
 *
 * Passing an existing node's id links to it instead of making a second copy.
 * That is the whole reason the duplicate check sits in front of this.
 */
export async function addRequirement(input: {
  nodeId: string;
  existingId?: string;
  /** An inventory item to require, of either kind. Reuses the node already
   * standing for it if there is one, so nothing ends up in the graph twice
   * with two prices. */
  inventory?: { kind: "material" | "tool"; id: string; name: string; unit: string };
  title?: string;
  nodeType?: NodeType;
  relationshipType: RelationshipType;
  strength?: number;
  /** How many units of it this needs. */
  quantity?: number | null;
  unit?: string;
}): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    let targetId = input.existingId;

    if (!targetId && input.inventory) {
      const { kind, id, name, unit } = input.inventory;
      const supabase = await createClient();
      const { data: existing } = await supabase
        .from("knowledge_nodes")
        .select("id")
        .eq(kind === "material" ? "material_id" : "tool_id", id)
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        targetId = existing.id;
      } else {
        const created = await createNode({
          title: name,
          // A tool is kit: bought once and used forever, which is what keeps
          // it out of the cost of a single run.
          nodeType: input.nodeType ?? (kind === "tool" ? "tool" : "material"),
          status: "idea",
          unit,
          materialId: kind === "material" ? id : null,
          toolId: kind === "tool" ? id : null,
        });
        if (!created.ok) return created;
        targetId = created.id;
      }
    }

    if (!targetId) {
      const created = await createNode({
        title: input.title ?? "",
        nodeType: input.nodeType ?? "material",
        status: "idea",
        unit: input.unit,
      });
      if (!created.ok) return created;
      targetId = created.id;
    }

    if (!targetId) return { ok: false, message: "Couldn't work out what to connect." };

    const linked = await createRelationship({
      sourceId: input.nodeId,
      targetId,
      relationshipType: input.relationshipType,
      strength: input.strength,
      quantity: input.quantity,
    });
    if (!linked.ok) return linked;

    revalidatePath(PATH);
    return { ok: true, id: targetId, message: "Broken down." };
  } catch (err) {
    console.error("addRequirement failed:", err);
    return { ok: false, message: "Couldn't add that requirement." };
  }
}

/**
 * Changes how much of something a connection needs.
 *
 * On the edge rather than the node, because the quantity is the part that
 * differs: door hangers need two thousand sheets and postcards need five
 * hundred, off the same cardstock at the same price.
 */
export async function updateRelationship(
  id: string,
  patch: { quantity?: number | null; strength?: number; notes?: string }
): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const update: Record<string, unknown> = {};
    if (patch.quantity !== undefined) update.quantity = quantityOrNull(patch.quantity);
    if (patch.strength !== undefined) update.strength = clampScale(patch.strength) ?? 3;
    if (patch.notes !== undefined) update.notes = patch.notes.trim() || null;
    if (Object.keys(update).length === 0) return { ok: true, id };

    const supabase = await createClient();
    const { error } = await supabase
      .from("knowledge_relationships")
      .update(update as never)
      .eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return { ok: true, id, message: "Saved." };
  } catch (err) {
    console.error("updateRelationship failed:", err);
    return { ok: false, message: "Couldn't save that." };
  }
}

/**
 * Points a node at the real material in inventory.
 *
 * Once linked, the material is the price and the purchase link — the graph
 * stops holding its own copy. That is the whole point: a supplier puts
 * cardstock up and the number in the graph moves, rather than two numbers
 * disagreeing until somebody notices at the till.
 */
export async function linkNodeToMaterial(
  nodeId: string,
  target: { kind: "material" | "tool"; id: string } | null
): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    // One or the other, never both — the database refuses it anyway, and a
    // node with two prices is the thing all of this exists to stop.
    const { error } = await supabase
      .from("knowledge_nodes")
      .update({
        material_id: target?.kind === "material" ? target.id : null,
        tool_id: target?.kind === "tool" ? target.id : null,
      } as never)
      .eq("id", nodeId);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return {
      ok: true,
      id: nodeId,
      message: target ? "Linked. Its price now comes from Inventory." : "Unlinked.",
    };
  } catch (err) {
    console.error("linkNodeToMaterial failed:", err);
    return { ok: false, message: "Couldn't link that." };
  }
}

/**
 * Attaches a way of making money to an idea.
 *
 * The same shape as adding a requirement, on purpose: something that costs
 * money and something that earns it are both just things an idea is connected
 * to, and making earning a different kind of operation is how it ends up being
 * the one nobody bothers with.
 *
 * A flyer is paper going through six hundred doors. Paper going through six
 * hundred doors has advertising space on it. This is where somebody writes
 * that down.
 */
export async function addEarner(input: {
  nodeId: string;
  existingId?: string;
  title?: string;
  /** What one of them is worth — one ad spot, one sponsorship, one referral. */
  unitValue?: number | null;
  /** How many of them this idea can carry. */
  quantity?: number | null;
}): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    let targetId = input.existingId;

    if (!targetId) {
      const created = await createNode({
        title: input.title ?? "",
        nodeType: "revenue_source",
        status: "idea",
        potentialValue: input.unitValue ?? null,
      });
      if (!created.ok) return created;
      targetId = created.id;
    }

    if (!targetId) return { ok: false, message: "Couldn't work out what to connect." };

    const linked = await createRelationship({
      sourceId: input.nodeId,
      targetId,
      relationshipType: "generates_revenue",
      quantity: input.quantity,
    });
    if (!linked.ok) return linked;

    revalidatePath(PATH);
    return { ok: true, id: targetId, message: "That is a way it pays for itself." };
  } catch (err) {
    console.error("addEarner failed:", err);
    return { ok: false, message: "Couldn't add that." };
  }
}

/** Removes one line. Not admin-gated the way deleting a node is: a wrong
 * connection is a small mistake, and leaving it there is a worse one. */
export async function deleteRelationship(id: string): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase.from("knowledge_relationships").delete().eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return { ok: true, message: "Disconnected." };
  } catch (err) {
    console.error("deleteRelationship failed:", err);
    return { ok: false, message: "Couldn't disconnect those." };
  }
}

/**
 * Remembers where somebody dragged things to.
 *
 * Saved without revalidating: the page already shows the node under the
 * finger that moved it, and re-rendering the whole graph on drop is how a
 * board fights the person arranging it.
 */
export async function saveNodePositions(
  positions: { id: string; x: number; y: number }[]
): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    if (positions.length === 0) return { ok: true };

    const supabase = await createClient();

    // One statement each rather than an upsert: an upsert needs every
    // not-null column, and this knows only two of them.
    const results = await Promise.all(
      positions.map((p) =>
        supabase
          .from("knowledge_nodes")
          .update({ position_x: p.x, position_y: p.y } as never)
          .eq("id", p.id)
      )
    );

    const failed = results.find((r) => r.error);
    if (failed?.error) return { ok: false, message: describeDbError(failed.error) };

    return { ok: true };
  } catch (err) {
    console.error("saveNodePositions failed:", err);
    return { ok: false, message: "Couldn't save the layout." };
  }
}

/**
 * Puts a date on an idea, and says whether it comes round again.
 *
 * Scheduling is deliberately a first-class thing you can do to any node, not
 * only to something called a task. The whole point of breaking an idea down
 * is that it becomes work, and work happens on days.
 */
export async function scheduleNode(
  id: string,
  input: { scheduledFor: string | null; recurrence?: Recurrence; recurrenceInterval?: number }
): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const scheduledFor = dateOrNull(input.scheduledFor);
    const recurrence = validRecurrence(input.recurrence);

    // A recurrence with no start date has nothing to recur from, and saving it
    // would leave something that says "every month" and never comes round.
    if (!scheduledFor && recurrence !== "none") {
      return { ok: false, message: "Pick the first date before setting it to repeat." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("knowledge_nodes")
      .update({
        scheduled_for: scheduledFor,
        recurrence,
        recurrence_interval: clampInterval(input.recurrenceInterval),
      } as never)
      .eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(PATH);
    return {
      ok: true,
      id,
      message: scheduledFor ? "Scheduled." : "Taken off the schedule.",
    };
  } catch (err) {
    console.error("scheduleNode failed:", err);
    return { ok: false, message: "Couldn't schedule that." };
  }
}

/**
 * Ticks something off, and rolls it forward if it repeats.
 *
 * The roll-forward is the reason recurrence is worth having at all: a monthly
 * thing that has to be re-entered every month is a monthly thing that stops
 * happening in March. A one-off simply comes off the schedule, keeping its
 * count, so the graph can still say the printer earned its money.
 */
export async function markNodeDone(id: string, on?: string): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("knowledge_nodes")
      .select("scheduled_for, recurrence, recurrence_interval, times_done")
      .eq("id", id)
      .single();
    if (error) return { ok: false, message: describeDbError(error) };

    const done = dateOrNull(on) ?? todayKey();
    const recurrence = validRecurrence(data.recurrence);
    const interval = clampInterval(data.recurrence_interval);

    // Stepped from the date it was due, not from today, so a job done two days
    // late does not drag every future one two days later with it.
    const from = data.scheduled_for ?? done;
    let next = advance(from, recurrence, interval);
    // If it was done very late, roll on until it is actually in front of us.
    for (let step = 0; step < 500 && next && next <= done; step++) {
      const following = advance(next, recurrence, interval);
      if (!following || following === next) break;
      next = following;
    }

    const { error: updateError } = await supabase
      .from("knowledge_nodes")
      .update({
        last_done_at: done,
        times_done: (data.times_done ?? 0) + 1,
        scheduled_for: next,
      } as never)
      .eq("id", id);
    if (updateError) return { ok: false, message: describeDbError(updateError) };

    revalidatePath(PATH);
    return {
      ok: true,
      id,
      message: next ? `Done. Next one ${next}.` : "Done.",
    };
  } catch (err) {
    console.error("markNodeDone failed:", err);
    return { ok: false, message: "Couldn't mark that done." };
  }
}

/** Tags, created on first use. A tag list somebody has to set up in advance is
 * a tag list nobody uses. */
async function applyTags(
  nodeId: string,
  organizationId: string,
  tags: string[],
  options: { replace?: boolean } = {}
): Promise<GraphResult> {
  const supabase = await createClient();
  const names = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];

  if (options.replace) {
    const { error } = await supabase.from("knowledge_node_tags").delete().eq("node_id", nodeId);
    if (error) return { ok: false, message: describeDbError(error) };
  }
  if (names.length === 0) return { ok: true };

  const { error: tagError } = await supabase
    .from("knowledge_tags")
    .upsert(
      names.map((name) => ({ organization_id: organizationId, name })) as never,
      { onConflict: "organization_id,name", ignoreDuplicates: true }
    );
  if (tagError) return { ok: false, message: describeDbError(tagError) };

  const { data: rows, error: readError } = await supabase
    .from("knowledge_tags")
    .select("id, name")
    .in("name", names);
  if (readError) return { ok: false, message: describeDbError(readError) };

  const links = (rows ?? []).map((r) => ({ node_id: nodeId, tag_id: r.id }));
  if (links.length === 0) return { ok: true };

  const { error: linkError } = await supabase
    .from("knowledge_node_tags")
    .upsert(links as never, { onConflict: "node_id,tag_id", ignoreDuplicates: true });
  if (linkError) return { ok: false, message: describeDbError(linkError) };

  return { ok: true };
}

/** A date, or nothing. An empty string arrives from a cleared date input and
 * means "no longer scheduled", not "the epoch". */
function dateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function validUnit(value: string | undefined): string {
  return value && VALID_UNITS.has(value) ? value : "each";
}

function validRecurrence(value: string | undefined): Recurrence {
  return value && VALID_RECURRENCES.has(value) ? (value as Recurrence) : "none";
}

function clampInterval(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 1;
  return Math.min(52, Math.max(1, Math.round(value)));
}

function clampScale(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.min(5, Math.max(1, Math.round(value)));
}

/** Nothing, or a number that is not negative. A negative quantity is a typo,
 * and storing it makes a total that reads as a discount. */
function quantityOrNull(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, value);
}

function numberOrNull(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value;
}
