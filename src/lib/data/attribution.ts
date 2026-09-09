import { createClient } from "@/lib/supabase/server";
import { embedded } from "@/lib/postgrest";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { netAppliedToJob, type Adjustment, type Receipt } from "@/lib/payments-net";
import {
  attribute,
  CREDIT_WINDOW_DAYS,
  healthOf,
  totalsByChannel,
  type Attribution,
  type AttributionTotals,
  type Channel,
} from "@/lib/attribution";

/**
 * Turning what the business recorded into what it can honestly say about where
 * the work came from.
 *
 * The money is net cash received, not what was invoiced. A campaign is not
 * credited with revenue the business never got: an attribution report built on
 * quoted totals will happily show a channel paying for itself out of an
 * invoice somebody refunded.
 */

const CHANNEL_OF_TYPE: Record<string, Channel> = {
  door_hanger: "door_hanger",
  "door-hanger": "door_hanger",
  hanger: "door_hanger",
  eddm: "eddm",
  mailer: "eddm",
  flyer: "flyer",
  yard_sign: "other_campaign",
  social: "other_campaign",
};

function channelOf(typeId: string | null): Channel {
  if (!typeId) return "other_campaign";
  const key = typeId.toLowerCase();
  return CHANNEL_OF_TYPE[key] ?? "other_campaign";
}

export interface AttributedJob {
  jobId: string;
  label: string;
  soldAt: string;
  revenueCents: number;
  attribution: Attribution;
}

export interface AttributionReport {
  jobs: AttributedJob[];
  totals: AttributionTotals;
  /** What the report can and cannot support, said above the numbers. */
  health: string[];
  since: string;
}

/**
 * Where the work of the last N days came from.
 *
 * Every read here is of something that was written at the time. Nothing is
 * back-filled and nothing is guessed: a job whose source nobody recorded comes
 * back as one of the two honest absences, and which of the two it is depends
 * on whether a campaign could have reached the address at all.
 */
export async function attributionReport(days = 365): Promise<AttributionReport> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [jobRows, waveRows, receiptRows, adjustmentRows, hangerRows] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, name, status, created_at, completed_at, source_attractor_wave_id, referred_by_profile_id, " +
          "property_id, properties!inner(address, customer_id), job_proposals(client_chosen_day, payment_path)"
      )
      .in("status", ["approved", "in_progress", "completed"])
      .gte("created_at", since)
      .limit(1000)
      .then((r) => r.data ?? []),
    supabase
      .from("attractor_waves")
      .select("id, name, type_id, date_completed, date_planned, geometry")
      .eq("organization_id", org)
      .then((r) => r.data ?? []),
    supabase.from("payments").select("id, job_id, amount, created_at").limit(5000).then((r) => r.data ?? []),
    supabase
      .from("payment_adjustments")
      .select("payment_id, job_id, kind, amount_cents")
      .eq("organization_id", org)
      .then((r) => r.data ?? []),
    // Which houses were actually hung, and when. The only record of a campaign
    // reaching one particular address rather than a zone in general.
    supabase
      .from("door_hanger_events")
      .select("house_id, zone_id, hung_at")
      .eq("organization_id", org)
      .gte("hung_at", new Date(Date.now() - (days + CREDIT_WINDOW_DAYS) * 86_400_000).toISOString())
      .limit(20000)
      .then((r) => r.data ?? []),
  ]);

  const waves = new Map(
    (waveRows as unknown as { id: string; name: string; type_id: string | null; date_completed: string | null; date_planned: string | null }[]).map(
      (w) => [w.id, w]
    )
  );

  // Which properties a house belongs to, so a hanging can be tied to a job.
  const houseIds = [...new Set((hangerRows as unknown as { house_id: string }[]).map((h) => h.house_id))];
  const propertyOfHouse = new Map<string, string>();
  if (houseIds.length > 0) {
    const { data } = await supabase.from("houses").select("id, property_id").in("id", houseIds.slice(0, 5000));
    for (const row of (data ?? []) as unknown as { id: string; property_id: string | null }[]) {
      if (row.property_id) propertyOfHouse.set(row.id, row.property_id);
    }
  }

  const hangingsByProperty = new Map<string, { zoneId: string | null; hungAt: string }[]>();
  for (const row of hangerRows as unknown as { house_id: string; zone_id: string | null; hung_at: string }[]) {
    const property = propertyOfHouse.get(row.house_id);
    if (!property) continue;
    const list = hangingsByProperty.get(property) ?? [];
    list.push({ zoneId: row.zone_id, hungAt: row.hung_at });
    hangingsByProperty.set(property, list);
  }

  // Money in, net of what went back out.
  const receiptsByJob = new Map<string, Receipt[]>();
  for (const row of receiptRows as unknown as { id: string; job_id: string | null; amount: number | null; created_at: string }[]) {
    if (!row.job_id) continue;
    const list = receiptsByJob.get(row.job_id) ?? [];
    list.push({ id: row.id, jobId: row.job_id, amountCents: Math.round((row.amount ?? 0) * 100), receivedAt: row.created_at });
    receiptsByJob.set(row.job_id, list);
  }
  const adjustmentsByJob = new Map<string, Adjustment[]>();
  for (const row of adjustmentRows as unknown as { payment_id: string; job_id: string; kind: string; amount_cents: number }[]) {
    const list = adjustmentsByJob.get(row.job_id) ?? [];
    list.push({ paymentId: row.payment_id, kind: row.kind as Adjustment["kind"], amountCents: row.amount_cents });
    adjustmentsByJob.set(row.job_id, list);
  }

  const rows = jobRows as unknown as {
    id: string;
    name: string;
    created_at: string;
    completed_at: string | null;
    source_attractor_wave_id: string | null;
    referred_by_profile_id: string | null;
    property_id: string | null;
    properties: { address: string | null; customer_id: string | null } | null;
    // PostgREST sends this as one object, not an array: job_proposals has a
    // UNIQUE on job_id. Both shapes are accepted rather than assumed.
    job_proposals: { client_chosen_day: string | null; payment_path: string | null }[] | { client_chosen_day: string | null; payment_path: string | null } | null;
  }[];

  // Clients who had already finished a job before this one was sold.
  const earlierByCustomer = new Map<string, string[]>();
  for (const row of rows) {
    const customer = row.properties?.customer_id;
    if (!customer || !row.completed_at) continue;
    const list = earlierByCustomer.get(customer) ?? [];
    list.push(row.completed_at);
    earlierByCustomer.set(customer, list);
  }

  const jobs: AttributedJob[] = rows.map((row) => {
    const wave = row.source_attractor_wave_id ? waves.get(row.source_attractor_wave_id) : null;
    const property = row.property_id;
    const soldAt = row.created_at;
    const windowStart = new Date(Date.parse(soldAt) - CREDIT_WINDOW_DAYS * 86_400_000).toISOString();

    // Campaigns that actually reached this address in the window, grouped by
    // the zone they were hung in -- a street hung twice in a fortnight is one
    // campaign, not fourteen.
    const hangings = (property ? (hangingsByProperty.get(property) ?? []) : []).filter(
      (h) => h.hungAt >= windowStart && h.hungAt <= soldAt
    );
    const byZone = new Map<string, string>();
    for (const h of hangings) {
      const key = h.zoneId ?? "unzoned";
      const held = byZone.get(key);
      if (!held || h.hungAt > held) byZone.set(key, h.hungAt);
    }
    const campaignsInRange = [...byZone.entries()].map(([zoneId, hungAt]) => ({
      waveId: zoneId,
      channel: "door_hanger" as Channel,
      deliveredAt: hungAt,
      label: `The hangers on ${new Date(hungAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    }));

    const customer = row.properties?.customer_id ?? null;
    const hadEarlier = customer
      ? (earlierByCustomer.get(customer) ?? []).some((at) => at < soldAt)
      : false;

    const attribution = attribute({
      jobId: row.id,
      sourceWaveId: row.source_attractor_wave_id,
      sourceWaveChannel: wave ? channelOf(wave.type_id) : null,
      referredByProfileId: row.referred_by_profile_id,
      hadEarlierCompletedJob: hadEarlier,
      cameThroughBookingLink: embedded(row.job_proposals).some((p) => p.client_chosen_day != null),
      campaignsInRange,
      // Off the map means nothing could be checked, which is a different
      // sentence from "nothing reached them".
      addressOnMap: property != null && propertyOfHouse.size >= 0 && hangingsByProperty.has(property),
    });

    return {
      jobId: row.id,
      label: row.properties?.address || row.name,
      soldAt,
      revenueCents: netAppliedToJob(row.id, receiptsByJob.get(row.id) ?? [], adjustmentsByJob.get(row.id) ?? []),
      attribution,
    };
  });

  const totals = totalsByChannel(jobs.map((j) => ({ attribution: j.attribution, revenueCents: j.revenueCents })));
  return { jobs, totals, health: healthOf(totals), since };
}
