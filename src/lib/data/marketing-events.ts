import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  windowStart,
  type MarketingEventInput,
  type MarketingEventKind,
} from "@/lib/marketing-events";

/**
 * Recording what the work is telling the marketing, without ever risking the
 * work.
 *
 * Every call here is a side effect of something that has already happened and
 * already been saved. It cannot fail the thing that caused it, because it
 * cannot throw: a broken campaign row must not stop somebody booking a job.
 * The failure goes to the log, the operational transaction stands, and the
 * opportunity is simply not there -- which is a marketing problem and not an
 * operational one.
 */

export interface RecordedEvent {
  id: string;
  kind: MarketingEventKind;
  jobId: string | null;
  zoneId: string | null;
  occurredAt: string;
  windowStart: string;
  detail: Record<string, unknown>;
}

/**
 * One opportunity per job, kind and window.
 *
 * The uniqueness is in the database, so a retried event, a double-delivered
 * webhook or somebody rescheduling four times in a morning updates one row
 * rather than making four. Nothing is printed or sent from here: an
 * opportunity is a thing somebody looks at and decides about, and the
 * marketing system already insists on an approval before a zone is walked.
 */
export async function recordMarketingEvent(input: MarketingEventInput): Promise<RecordedEvent | null> {
  try {
    const supabase = await createClient();
    const org = await getCurrentOrganizationId();
    const window = windowStart(input.occurredAt);

    const { data, error } = await supabase
      .from("marketing_events")
      .upsert(
        {
          organization_id: org,
          kind: input.kind,
          job_id: input.jobId,
          property_id: input.propertyId,
          customer_id: input.customerId,
          zone_id: input.zoneId,
          window_start: window,
          occurred_at: input.occurredAt,
          source: input.source,
          detail: (input.detail ?? {}) as never,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id,kind,window_start" }
      )
      .select("id, kind, job_id, zone_id, occurred_at, window_start, detail")
      .single();
    if (error) throw error;

    return {
      id: data.id as string,
      kind: data.kind as MarketingEventKind,
      jobId: (data.job_id as string | null) ?? null,
      zoneId: (data.zone_id as string | null) ?? null,
      occurredAt: data.occurred_at as string,
      windowStart: data.window_start as string,
      detail: (data.detail ?? {}) as Record<string, unknown>,
    };
  } catch (err) {
    // Deliberately swallowed. See the note at the top of this file: the thing
    // that caused this event has already happened and must not be undone
    // because the marketing side of it did not record.
    console.error("[marketing] could not record", input.kind, "for job", input.jobId, err);
    return null;
  }
}

/**
 * Everything the work has offered the marketing lately.
 *
 * Read for the Marketing module, newest first. The zone is what ties an
 * opportunity to a walk somebody can actually do.
 */
export async function listMarketingEvents(limit = 100): Promise<RecordedEvent[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const { data, error } = await supabase
    .from("marketing_events")
    .select("id, kind, job_id, zone_id, occurred_at, window_start, detail")
    .eq("organization_id", org)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as unknown as {
    id: string;
    kind: string;
    job_id: string | null;
    zone_id: string | null;
    occurred_at: string;
    window_start: string;
    detail: Record<string, unknown> | null;
  }[]).map((row) => ({
    id: row.id,
    kind: row.kind as MarketingEventKind,
    jobId: row.job_id,
    zoneId: row.zone_id,
    occurredAt: row.occurred_at,
    windowStart: row.window_start,
    detail: row.detail ?? {},
  }));
}

/**
 * The property's own context, gathered once so an event carries it.
 *
 * The chain the business wants afterwards is campaign → lead → evaluation →
 * proposal → job → revenue, and the only way to have it is to write down what
 * was known at the time. Where a link genuinely is not known it stays null:
 * an invented attribution is worse than an absent one, because somebody will
 * believe it.
 */
export async function marketingContext(jobId: string): Promise<{
  propertyId: string | null;
  customerId: string | null;
  zoneId: string | null;
  source: string | null;
}> {
  try {
    const supabase = await createClient();
    const { data: job } = await supabase
      .from("jobs")
      .select("property_id, source_attractor_wave_id, properties(id, customer_id, lat, lng)")
      .eq("id", jobId)
      .maybeSingle();

    const property = (job?.properties ?? null) as { id: string; customer_id: string | null; lat: number | null; lng: number | null } | null;

    // The zone the property sits in, through the house the map already
    // matched to it. Null where the map does not know the address -- which is
    // honest, and means the opportunity has no walk attached rather than a
    // guessed one.
    let zoneId: string | null = null;
    if (property?.id) {
      const { data: house } = await supabase
        .from("houses")
        .select("id, zone_houses(zone_id)")
        .eq("property_id", property.id)
        .limit(1)
        .maybeSingle();
      const zones = (house?.zone_houses ?? []) as { zone_id: string }[];
      zoneId = zones[0]?.zone_id ?? null;
    }

    return {
      propertyId: property?.id ?? (job?.property_id as string | null) ?? null,
      customerId: property?.customer_id ?? null,
      zoneId,
      // What brought the work in, where the job records it.
      source: (job?.source_attractor_wave_id as string | null) ?? null,
    };
  } catch (err) {
    console.error("[marketing] could not read context for job", jobId, err);
    return { propertyId: null, customerId: null, zoneId: null, source: null };
  }
}
