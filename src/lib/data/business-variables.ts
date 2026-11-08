import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkZone } from "@/components/canvas/types";
import { getMaterialSuppliers } from "@/lib/data/material-suppliers";
import { cleanAnswers } from "@/lib/evaluation-intake";
import type { PriceSources } from "@/lib/pricing-materials";
import { elapsedMinutes, type AppFigures, type AreaInput, type ProjectInput } from "@/lib/pricing-report";
import { DEFAULT_VARIABLES, readVariables, type PricingVariables } from "@/lib/pricing-variables";
import { looksLikeTransfer } from "@/lib/recurring";

/**
 * The pricing report against the database: the business's saved variables,
 * what the app already knows about its indirect costs, project minutes and
 * capacity, the material prices it already has, and each job's saved input.
 *
 * Everything here degrades to the code's starting figures when the tables
 * aren't there yet (migration 0371 not applied), so the report always works.
 */

// The new tables are newer than the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;
const untyped = (c: unknown) => c as Db;

const missingTable = (error: { code?: string; message?: string } | null, table: string) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || new RegExp(table).test(error.message ?? "")));

export interface StoredVariables {
  variables: PricingVariables;
  /** The business has saved its own; false while the starting figures are in use. */
  saved: boolean;
  /** False until migration 0371 is applied: nothing can be saved. */
  canSave: boolean;
  updatedAt: string | null;
}

export async function getBusinessVariables(client: unknown, organizationId: string): Promise<StoredVariables> {
  const { data, error } = await untyped(client).from("business_variables").select("variables, updated_at").eq("organization_id", organizationId).maybeSingle();
  if (error) {
    const missing = missingTable(error, "business_variables");
    if (!missing) console.error("[business-variables] read failed:", error.message);
    return { variables: DEFAULT_VARIABLES, saved: false, canSave: !missing, updatedAt: null };
  }
  if (!data) return { variables: DEFAULT_VARIABLES, saved: false, canSave: true, updatedAt: null };
  return { variables: readVariables((data as { variables: unknown }).variables), saved: true, canSave: true, updatedAt: (data as { updated_at: string }).updated_at };
}

const DAY = 86_400_000;
/** Spending that is a job's own material, so it stays out of the indirect pool. */
const DIRECT_SPEND = /\b(mulch|nursery|nurseries|landscape supply|stone ?yard|quarry|topsoil|landfill|dump|transfer station|equipment rental|sunbelt|united rentals|herc)\b/i;

/**
 * IC₉₀ from the bank feed, PM₉₀ from the crew's clock, booked hours from the
 * proposals scheduled in the capacity window. Each is null when there is
 * nothing to read, so the figure entered by hand is used instead.
 */
export async function getAppFigures(client: unknown, organizationId: string, vars: PricingVariables, now = new Date()): Promise<AppFigures> {
  const db = untyped(client);
  const since = new Date(now.getTime() - 90 * DAY);
  const notes: string[] = [];
  const windowEnd = new Date(now.getTime() + vars.capacity.windowWeeks * 7 * DAY);

  const [bank, suppliers, clock, booked] = await Promise.all([
    db
      .from("bank_transactions")
      .select("amount, name, merchant")
      .eq("organization_id", organizationId)
      .gt("amount", 0)
      .eq("pending", false)
      .gte("posted_on", since.toISOString().slice(0, 10)),
    db.from("material_suppliers").select("name").eq("organization_id", organizationId),
    db
      .from("time_entries")
      .select("job_id, clocked_in_at, clocked_out_at")
      .eq("organization_id", organizationId)
      .not("job_id", "is", null)
      .not("clocked_out_at", "is", null)
      .gte("clocked_in_at", since.toISOString()),
    db
      .from("jobs")
      // jobs has no organization column: scoped by the signed-in person's row security.
      .select("id, project_start_date, cancelled_at, completed_at, proposal:job_proposals(estimate)")
      .gte("project_start_date", now.toISOString().slice(0, 10))
      .lte("project_start_date", windowEnd.toISOString().slice(0, 10))
      .is("cancelled_at", null),
  ]);

  let ic90Cents: number | null = null;
  if (!bank.error && bank.data && bank.data.length > 0) {
    const supplierNames = ((suppliers.data ?? []) as { name: string }[]).map((s) => s.name.toLowerCase()).filter((n) => n.length > 3);
    let cents = 0;
    for (const t of bank.data as { amount: number; name: string | null; merchant: string | null }[]) {
      const who = `${t.merchant ?? ""} ${t.name ?? ""}`;
      if (looksLikeTransfer(who) || DIRECT_SPEND.test(who) || supplierNames.some((n) => who.toLowerCase().includes(n))) continue;
      cents += Math.round(Number(t.amount) * 100);
    }
    if (cents > 0) {
      ic90Cents = cents;
      notes.push("IC₉₀ is every bank outflow in 90 days, less transfers and supplier, dump and rental spend. Equipment bought outright is in it in full: enter IC₉₀ by hand if a big purchase landed.");
    }
  }

  let pm90Minutes: number | null = null;
  if (!clock.error && clock.data && clock.data.length > 0) {
    const minutes = elapsedMinutes(
      (clock.data as { job_id: string; clocked_in_at: string; clocked_out_at: string }[]).map((e) => ({
        jobId: e.job_id,
        start: new Date(e.clocked_in_at).getTime(),
        end: new Date(e.clocked_out_at).getTime(),
      }))
    );
    if (minutes > 0) pm90Minutes = Math.round(minutes);
  }

  let bookedHours: number | null = null;
  if (!booked.error && booked.data) {
    bookedHours = 0;
    for (const j of booked.data as { completed_at: string | null; proposal: { estimate: unknown }[] | { estimate: unknown } | null }[]) {
      if (j.completed_at) continue;
      const p = Array.isArray(j.proposal) ? j.proposal[0] : j.proposal;
      const est = (p?.estimate ?? null) as { billedHours?: number } | null;
      if (est && Number.isFinite(est.billedHours)) bookedHours += Number(est.billedHours);
    }
    bookedHours = Math.round(bookedHours * 10) / 10;
  }
  const c = vars.capacity;
  const availableHours = c.crews * vars.crew.hoursPerDay * c.workdaysPerWeek * c.windowWeeks;
  return { ic90Cents, pm90Minutes, bookedHours, availableHours, notes };
}

/** Material prices the app already has: bulk supplier products and inventory costs. */
export async function getPriceSources(client: unknown, organizationId: string): Promise<PriceSources> {
  const [{ suppliers }, inventory] = await Promise.all([
    getMaterialSuppliers(client as never, organizationId).catch(() => ({ suppliers: [], available: false })),
    untyped(client).from("materials").select("name, unit, cost_per_unit").eq("organization_id", organizationId).eq("active", true),
  ]);
  return {
    supplierProducts: suppliers.flatMap((s) => s.products.map((p) => ({ supplier: s.name, kind: p.kind, name: p.name, unit: p.unit, priceCents: p.priceCents }))),
    inventory: ((inventory.data ?? []) as { name: string; unit: string | null; cost_per_unit: number | null }[]).map((m) => ({
      name: m.name,
      unit: m.unit,
      costPerUnit: m.cost_per_unit != null ? Number(m.cost_per_unit) : null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* A job's input                                                       */
/* ------------------------------------------------------------------ */

export interface StoredEstimate {
  input: ProjectInput;
  saved: boolean;
  canSave: boolean;
  updatedAt: string | null;
}

/** The saved input, made safe enough to price: anything odd is dropped rather than trusted. */
export function readProjectInput(raw: unknown, fallback: ProjectInput): ProjectInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ProjectInput>;
  if (!Array.isArray(o.areas)) return fallback;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const areas: AreaInput[] = o.areas.slice(0, 30).map((a, i) => ({
    id: String(a?.id ?? `area-${i + 1}`).slice(0, 60),
    name: String(a?.name ?? `Area ${i + 1}`).slice(0, 80),
    sf: n(a?.sf),
    lf: n(a?.lf),
    depthIn: n(a?.depthIn),
    tasks: Array.isArray(a?.tasks) ? a.tasks.slice(0, 40).map((t) => ({ key: String(t?.key ?? ""), qty: n(t?.qty) })).filter((t) => t.key) : [],
    conditions: a?.conditions && typeof a.conditions === "object" ? Object.fromEntries(Object.entries(a.conditions).map(([k, v]) => [k, String(v)])) : {},
    suggested: a?.suggested ?? null,
    confirmed: a?.confirmed === true,
    photos: Array.isArray(a?.photos) ? a.photos.map(String).slice(0, 12) : [],
    wants: typeof a?.wants === "string" ? a.wants.slice(0, 500) : null,
  }));
  const d = (o.direct ?? {}) as Record<string, unknown>;
  return {
    ...fallback,
    areas,
    crew: o.crew && Number.isFinite(o.crew.leads) && Number.isFinite(o.crew.techs) ? { leads: Math.max(0, Math.round(o.crew.leads)), techs: Math.max(0, Math.round(o.crew.techs)) } : fallback.crew,
    driveMinutesEachWay: n(o.driveMinutesEachWay) ?? fallback.driveMinutesEachWay,
    disposalTrips: n(o.disposalTrips) ?? 0,
    smallItems: n(o.smallItems),
    largeItems: n(o.largeItems),
    direct: {
      delivery: n(d.delivery) ?? 0,
      subcontractors: n(d.subcontractors) ?? 0,
      rentals: n(d.rentals) ?? 0,
      permits: n(d.permits) ?? 0,
      other: n(d.other) ?? 0,
    },
  };
}

/**
 * The areas a job starts from before anybody has saved one: the site map's
 * measured areas, else the photo quote's areas, with their photos.
 */
export function startingAreas(zones: WorkZone[], photosByZone: Map<string, string[]>, intakeAnswers: unknown): AreaInput[] {
  const measured = zones.filter((z) => z.areaSqFt || z.perimeterFt || z.service);
  if (measured.length > 0) {
    return measured.map((z, i) => ({
      id: z.id || `zone-${i + 1}`,
      name: z.name || `Area ${i + 1}`,
      sf: z.areaSqFt ?? null,
      lf: z.perimeterFt ?? null,
      depthIn: null,
      tasks: [],
      conditions: {},
      confirmed: false,
      photos: photosByZone.get(z.id) ?? [],
      wants: null,
    }));
  }
  const answers = cleanAnswers(intakeAnswers);
  return answers.spots.map((spot, i) => ({
    id: spot.id,
    name: `Area ${i + 1}`,
    sf: null,
    lf: null,
    depthIn: null,
    tasks: [],
    conditions: {},
    confirmed: false,
    photos: answers.photos.filter((p) => answers.photo_areas[p] === spot.id),
    wants: spot.wants || null,
  }));
}

export async function getPricingEstimate(client: unknown, organizationId: string, jobId: string, fallback: ProjectInput): Promise<StoredEstimate> {
  const { data, error } = await untyped(client).from("pricing_estimates").select("input, updated_at").eq("organization_id", organizationId).eq("job_id", jobId).maybeSingle();
  if (error) {
    const missing = missingTable(error, "pricing_estimates");
    if (!missing) console.error("[pricing-estimates] read failed:", error.message);
    return { input: fallback, saved: false, canSave: !missing, updatedAt: null };
  }
  if (!data) return { input: fallback, saved: false, canSave: true, updatedAt: null };
  return { input: readProjectInput((data as { input: unknown }).input, fallback), saved: true, canSave: true, updatedAt: (data as { updated_at: string }).updated_at };
}
