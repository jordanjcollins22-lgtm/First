import type { EntityContext, EntityRow } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import { shortPlace } from "@/lib/entities/ops-helpers";

/**
 * Reads the Operations handlers share. Every one is pinned to the owner's
 * own business: a table with an organization_id is filtered on it, and a
 * job (which has none) is checked through the client who owns its property.
 */

export type Row = Record<string, unknown>;

export const str = (x: unknown) => (typeof x === "string" ? x : x == null ? "" : String(x));
export const numOrNull = (x: unknown) => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);

/** One row of an organization's table, or null when it isn't theirs. */
export async function own(ctx: EntityContext, table: string, cols: string, id: string): Promise<Row | null> {
  try {
    const { data, error } = await ctx.sb.from(table).select(cols).eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    return error ? null : ((data as Row | null) ?? null);
  } catch {
    return null;
  }
}

/** Several rows of an organization's table. Empty when the table isn't there or can't be read. */
export async function many(
  ctx: EntityContext,
  table: string,
  cols: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter?: (q: any) => any
): Promise<Row[]> {
  try {
    let q = ctx.sb.from(table).select(cols).eq("organization_id", ctx.organizationId);
    if (filter) q = filter(q);
    const { data, error } = await q;
    return error ? [] : ((data ?? []) as unknown as Row[]);
  } catch {
    return [];
  }
}

const JOB_OWNER = "property:properties!inner(address, customer:customers!inner(id, name, email, phone, organization_id))";

/** A job, only if it is this business's. */
export async function ownJob(ctx: EntityContext, id: string, cols = "id, name, status"): Promise<Row | null> {
  try {
    const { data, error } = await ctx.sb
      .from("jobs")
      .select(`${cols}, ${JOB_OWNER}`)
      .eq("id", id)
      .eq("property.customer.organization_id", ctx.organizationId)
      .maybeSingle();
    return error ? null : ((data as Row | null) ?? null);
  } catch {
    return null;
  }
}

/** Names for several jobs, by id: their address where there is one. */
export async function jobNames(ctx: EntityContext, ids: unknown[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (!list.length) return new Map();
  try {
    const { data } = await ctx.sb
      .from("jobs")
      .select(`id, name, ${JOB_OWNER}`)
      .in("id", list.slice(0, 300))
      .eq("property.customer.organization_id", ctx.organizationId);
    return new Map(((data ?? []) as Row[]).map((j) => [str(j.id), jobLabel(j)]));
  } catch {
    return new Map();
  }
}

/** What a job is called on a row: the street and town, or its name. */
export function jobLabel(j: Row | null | undefined): string {
  if (!j) return "Job";
  const prop = j.property as { address?: string | null } | null | undefined;
  return shortPlace(prop?.address || j.name);
}

export function jobRow(jobId: unknown, label: string): EntityRow {
  return row(label, "ops.job", jobId);
}

/** Names for several people, by profile id. */
export async function peopleNames(ctx: EntityContext, ids: unknown[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (!list.length) return new Map();
  const rows = await many(ctx, "profiles", "id, full_name, email", (q) => q.in("id", list.slice(0, 300)));
  return new Map(rows.map((p) => [str(p.id), str(p.full_name) || str(p.email) || "[no name on profile]"]));
}

/** The project team as choices: everyone with the crew or project lead role. */
export async function teamChoices(ctx: EntityContext, exclude: string[] = []): Promise<{ value: string; label: string }[]> {
  const profiles = await many(ctx, "profiles", "id, full_name, email");
  if (!profiles.length) return [];
  let roles: Row[] = [];
  try {
    const { data } = await ctx.sb
      .from("profile_roles")
      .select("profile_id, role_name")
      .in("profile_id", profiles.map((p) => str(p.id)).slice(0, 500));
    roles = (data ?? []) as Row[];
  } catch {
    roles = [];
  }
  const onTeam = new Set(roles.filter((r) => r.role_name === "crew" || r.role_name === "project lead").map((r) => str(r.profile_id)));
  return profiles
    .filter((p) => onTeam.has(str(p.id)) && !exclude.includes(str(p.id)))
    .map((p) => ({ value: str(p.id), label: str(p.full_name) || str(p.email) || "[no name on profile]" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Today in the business's time zone, as YYYY-MM-DD. */
export function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
