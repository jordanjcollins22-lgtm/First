import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getBusyBlocksAsAdmin } from "@/lib/data/busy";
import { loadTerritories } from "@/lib/data/territories";
import { freeOf } from "@/lib/busy";
import { SLOT_MINUTES } from "@/lib/booking-availability";
import { chooseEvaluator, type Choice, type EvaluatorDay } from "@/lib/evaluator-choice";

/**
 * Who should do an evaluation booked somewhere other than /book: a booking
 * made in GoHighLevel, by the webhook or the calendar pull.
 *
 * /book already chose well (nearest already going that way, then the
 * lighter day, then whoever waited longest, and now territories first). A
 * GoHighLevel booking was only ever given to the evaluator when there was
 * exactly one; with two or more nobody was put on it at all. This gives it
 * the same choice: of the people who do evaluations and are free at that
 * time, the one whose territory it is, then the usual rules. Nobody free
 * still gets somebody (the client was already told the time), chosen among
 * everybody by the same rules, and the reason says so.
 */
export async function routeEvaluation(
  admin: SupabaseClient<Database>,
  input: { organizationId: string; startsAt: string; endsAt: string | null; lat: number; lng: number; zip: string | null }
): Promise<Choice | null> {
  const { data: people } = await admin.from("profiles").select("id").eq("organization_id", input.organizationId).eq("does_evaluations", true);
  const ids = (people ?? []).map((p) => p.id);
  if (ids.length === 0) return null;
  if (ids.length === 1) return { evaluatorId: ids[0], why: "The only one who does evaluations." };

  const start = new Date(input.startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = input.endsAt && !Number.isNaN(new Date(input.endsAt).getTime()) ? new Date(input.endsAt) : new Date(start.getTime() + SLOT_MINUTES * 60_000);
  const blocks = await getBusyBlocksAsAdmin().catch(() => []);
  const free = freeOf(blocks, ids, { start, end });
  const [{ territories }, days] = await Promise.all([
    loadTerritories(admin, input.organizationId).catch(() => ({ territories: [] })),
    evaluatorDays(admin, free.length ? free : ids, start),
  ]);
  const where = { lat: input.lat, lng: input.lng, zip: input.zip };
  if (free.length > 0) return chooseEvaluator(free, days, where, territories);
  const fallback = chooseEvaluator(ids, days, where, territories);
  return fallback ? { ...fallback, why: `Nobody was free at that time. ${fallback.why}` } : null;
}

/** Each person's visits that day and when they were last given one: what the choice weighs. */
async function evaluatorDays(admin: SupabaseClient<Database>, ids: string[], at: Date): Promise<EvaluatorDay[]> {
  // The business's day, near enough: the 24 hours around noon that day in Maryland.
  const dayStart = new Date(at.getTime() - 12 * 3_600_000);
  const dayEnd = new Date(at.getTime() + 12 * 3_600_000);
  const [{ data: rows }, { data: latest }] = await Promise.all([
    admin
      .from("jobs")
      .select("assigned_to, properties(lat, lng)")
      .in("assigned_to", ids)
      .neq("evaluation_status", "cancelled")
      .gte("evaluation_date", dayStart.toISOString())
      .lt("evaluation_date", dayEnd.toISOString()),
    admin.from("jobs").select("assigned_to, created_at").in("assigned_to", ids).not("evaluation_date", "is", null).order("created_at", { ascending: false }).limit(200),
  ]);
  const visits = new Map<string, { lat: number | null; lng: number | null }[]>();
  for (const raw of rows ?? []) {
    const row = raw as unknown as { assigned_to: string | null; properties: { lat: number | null; lng: number | null } | null };
    if (!row.assigned_to) continue;
    visits.set(row.assigned_to, [...(visits.get(row.assigned_to) ?? []), { lat: row.properties?.lat ?? null, lng: row.properties?.lng ?? null }]);
  }
  const lastBooked = new Map<string, string>();
  for (const row of (latest ?? []) as { assigned_to: string | null; created_at: string }[]) {
    if (row.assigned_to && !lastBooked.has(row.assigned_to)) lastBooked.set(row.assigned_to, row.created_at);
  }
  return ids.map((id) => ({ evaluatorId: id, visits: visits.get(id) ?? [], lastBookedAt: lastBooked.get(id) ?? null }));
}
