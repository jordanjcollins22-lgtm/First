"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
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

export interface NodeInput {
  title: string;
  nodeType?: NodeType;
  status?: NodeStatus;
  description?: string;
  notes?: string;
  importance?: number | null;
  estimatedCost?: number | null;
  potentialValue?: number | null;
  tags?: string[];
  positionX?: number | null;
  positionY?: number | null;
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
        estimated_cost: numberOrNull(input.estimatedCost),
        potential_value: numberOrNull(input.potentialValue),
        position_x: input.positionX ?? null,
        position_y: input.positionY ?? null,
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
    if (patch.estimatedCost !== undefined) update.estimated_cost = numberOrNull(patch.estimatedCost);
    if (patch.potentialValue !== undefined) update.potential_value = numberOrNull(patch.potentialValue);

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
  title?: string;
  nodeType?: NodeType;
  relationshipType: RelationshipType;
  strength?: number;
}): Promise<GraphResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    let targetId = input.existingId;

    if (!targetId) {
      const created = await createNode({
        title: input.title ?? "",
        nodeType: input.nodeType ?? "material",
        status: "idea",
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
    });
    if (!linked.ok) return linked;

    revalidatePath(PATH);
    return { ok: true, id: targetId, message: "Broken down." };
  } catch (err) {
    console.error("addRequirement failed:", err);
    return { ok: false, message: "Couldn't add that requirement." };
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

function clampScale(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function numberOrNull(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value;
}
