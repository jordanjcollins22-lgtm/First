import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import { notifyTeamMember } from "@/lib/notifications";
import { hasRole, isOwnerLevel } from "@/lib/roles";
import { dateKeyIn, timeOnly, weekdayDate } from "@/lib/time-zone";
import { poundsFor, saltExpired, saltSettingsFrom, type Surface } from "@/lib/salt";
import { addDays } from "@/lib/weather-cascade/rules";
import { fetchCascadeForecast, locationKeyFor, pointFromKey } from "@/lib/weather-cascade/forecast";
import { coveredSince } from "@/lib/weather-cascade/settings";
import { loadWeatherOpsSettings } from "@/lib/data/weather-cascade";
import { orderRoute } from "@/lib/snow/route";
import { recommendApplication, suggestSnowEvent, type SaltProduct } from "@/lib/snow/application";
import {
  isContractType,
  prepaidDraw,
  servicedDedupeKey,
  servicedNotice,
  snowBillFor,
  type ContractType,
  type LoggedStop,
  type SnowContract,
} from "@/lib/snow/billing";
import { createSnowStripeInvoice } from "@/lib/snow/stripe-invoice";

/**
 * Snow events: the storm, its route, what the crew logged, and the bills.
 *
 * The route is built from the salt clients already on file (salt_orders):
 * prepaid clients with treatments left, and every client on a snow contract.
 * Nothing about a client is copied anywhere it could drift: a stop keeps the
 * name and address it was driven to, for the record, and points back at the
 * order for everything else.
 */

// These tables are newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

export const SNOW_PHOTO_BUCKET = "job-photos";

export function proofUrlFor(token: string): string {
  const base = (env.appUrl || "https://app.jslandscapingmd.com").replace(/\/$/, "");
  return `${base}/salt/serviced/${token}`;
}

export interface SaltClientRow {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  surface: Surface;
  petFriendly: boolean;
  status: string;
  treatments: number;
  used: number;
  paidAt: string | null;
  customerId: string | null;
  propertyId: string | null;
  jobId: string | null;
  contract: SnowContract;
  triggerDepthIn: number | null;
  areaSqft: number | null;
  includesPlowing: boolean;
  routeOrder: number | null;
}

const SALT_CLIENT_COLUMNS =
  "id, name, address, lat, lng, surface, pet_friendly, status, treatments, treatments_used, paid_at, customer_id, property_id, job_id, " +
  "contract_type, rate_per_push_cents, rate_per_application_cents, rate_per_event_cents, seasonal_price_cents, trigger_depth_in, area_sqft, includes_plowing, route_order";

function toSaltClient(row: Record<string, unknown>): SaltClientRow {
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    id: String(row.id),
    name: String(row.name ?? "Client"),
    address: String(row.address ?? ""),
    lat: num(row.lat),
    lng: num(row.lng),
    surface: (row.surface as Surface) ?? "both",
    petFriendly: Boolean(row.pet_friendly),
    status: String(row.status),
    treatments: Number(row.treatments ?? 0),
    used: Number(row.treatments_used ?? 0),
    paidAt: (row.paid_at as string | null) ?? null,
    customerId: (row.customer_id as string | null) ?? null,
    propertyId: (row.property_id as string | null) ?? null,
    jobId: (row.job_id as string | null) ?? null,
    contract: {
      type: isContractType(row.contract_type) ? row.contract_type : "prepaid",
      ratePerPushCents: num(row.rate_per_push_cents),
      ratePerApplicationCents: num(row.rate_per_application_cents),
      ratePerEventCents: num(row.rate_per_event_cents),
      seasonalPriceCents: num(row.seasonal_price_cents),
    },
    triggerDepthIn: num(row.trigger_depth_in),
    areaSqft: num(row.area_sqft),
    includesPlowing: Boolean(row.includes_plowing),
    routeOrder: num(row.route_order),
  };
}

/** Whether this client is on the snow route this winter. */
export function onTheRoute(c: SaltClientRow, now = new Date()): boolean {
  if (c.status === "cancelled") return false;
  if (c.contract.type !== "prepaid") return true;
  // Prepaid: paid, with treatments left, and inside the two years.
  return c.status === "paid" && c.used < c.treatments && !saltExpired(c.paidAt, now);
}

export async function listSaltClients(client: unknown): Promise<SaltClientRow[]> {
  const { data, error } = await untyped(client).from("salt_orders").select(SALT_CLIENT_COLUMNS).order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toSaltClient);
}

/** The salt clients on the route, in the order the route drives them. */
export async function buildSnowRoute(client: unknown, organizationId: string): Promise<SaltClientRow[]> {
  const sb = untyped(client);
  const [clients, { data: shop }] = await Promise.all([
    listSaltClients(sb),
    sb.from("business_locations").select("lat, lng").eq("organization_id", organizationId).limit(1).maybeSingle(),
  ]);
  const live = clients.filter((c) => onTheRoute(c));
  return orderRoute(
    live.map((c) => ({ ...c, routeOrder: c.routeOrder })),
    (shop as { lat: number | null; lng: number | null } | null) ?? null
  );
}

/**
 * Start a storm: one tap. Turns a suggestion into the live event when one is
 * given, and lays out the route as stops. The database allows one live event
 * per business, so a second tap does not start a second storm.
 */
export async function startSnowEvent(
  client: unknown,
  input: { organizationId: string; by: string; service: "pretreat" | "salt" | "plow"; label?: string | null; suggestionId?: string | null }
): Promise<{ eventId: string; stops: number }> {
  const sb = untyped(client);
  const now = new Date();
  const label = input.label?.trim() || `${input.service === "plow" ? "Snow" : input.service === "pretreat" ? "Pre-treat" : "Ice"} ${weekdayDate(now)}`;

  let eventId: string;
  if (input.suggestionId) {
    const { data, error } = await sb
      .from("snow_events")
      .update({ status: "active", service: input.service, started_at: now.toISOString(), started_by: input.by, label })
      .eq("id", input.suggestionId)
      .eq("status", "suggested")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("That suggestion has already been started or dismissed.");
    eventId = (data as { id: string }).id;
  } else {
    const { data, error } = await sb
      .from("snow_events")
      .insert({ organization_id: input.organizationId, status: "active", source: "manual", service: input.service, label, started_at: now.toISOString(), started_by: input.by })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("A snow event is already running. Close it before starting another.");
      throw error;
    }
    eventId = (data as { id: string }).id;
  }

  const route = await buildSnowRoute(sb, input.organizationId);
  if (route.length > 0) {
    const { error } = await sb.from("snow_event_stops").upsert(
      route.map((c, index) => ({
        organization_id: input.organizationId,
        event_id: eventId,
        salt_order_id: c.id,
        customer_id: c.customerId,
        property_id: c.propertyId,
        job_id: c.jobId,
        position: index + 1,
        name: c.name,
        address: c.address,
        lat: c.lat,
        lng: c.lng,
      })),
      { onConflict: "event_id,salt_order_id", ignoreDuplicates: true }
    );
    if (error) throw error;
  }
  return { eventId, stops: route.length };
}

export interface SnowStop {
  id: string;
  eventId: string;
  saltOrderId: string;
  position: number;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  status: "pending" | "done" | "skipped";
  servicedAt: string | null;
  surfaceTempF: number | null;
  depthIn: number | null;
  service: LoggedStop["service"];
  product: SaltProduct | null;
  saltLbs: number | null;
  saltBags: number | null;
  brineGallons: number | null;
  pushes: number;
  applications: number;
  recommendedLbs: number | null;
  photoPaths: string[];
  gps: { lat: number; lng: number; accuracyM: number | null } | null;
  note: string | null;
  skipReason: string | null;
  proofToken: string;
  clientNotifiedAt: string | null;
}

export const STOP_COLUMNS =
  "id, event_id, salt_order_id, position, name, address, lat, lng, status, serviced_at, surface_temp_f, depth_in, service, product, salt_lbs, salt_bags, brine_gallons, pushes, applications, recommended_lbs, photo_paths, gps_lat, gps_lng, gps_accuracy_m, note, skip_reason, proof_token, client_notified_at";

export function toStop(row: Record<string, unknown>): SnowStop {
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    saltOrderId: String(row.salt_order_id),
    position: Number(row.position ?? 0),
    name: String(row.name ?? ""),
    address: String(row.address ?? ""),
    lat: num(row.lat),
    lng: num(row.lng),
    status: (row.status as SnowStop["status"]) ?? "pending",
    servicedAt: (row.serviced_at as string | null) ?? null,
    surfaceTempF: num(row.surface_temp_f),
    depthIn: num(row.depth_in),
    service: (row.service as SnowStop["service"]) ?? null,
    product: (row.product as SaltProduct | null) ?? null,
    saltLbs: num(row.salt_lbs),
    saltBags: num(row.salt_bags),
    brineGallons: num(row.brine_gallons),
    pushes: Number(row.pushes ?? 0),
    applications: Number(row.applications ?? 0),
    recommendedLbs: num(row.recommended_lbs),
    photoPaths: (row.photo_paths as string[] | null) ?? [],
    gps: row.gps_lat != null && row.gps_lng != null ? { lat: Number(row.gps_lat), lng: Number(row.gps_lng), accuracyM: num(row.gps_accuracy_m) } : null,
    note: (row.note as string | null) ?? null,
    skipReason: (row.skip_reason as string | null) ?? null,
    proofToken: String(row.proof_token ?? ""),
    clientNotifiedAt: (row.client_notified_at as string | null) ?? null,
  };
}

/** What the crew should put down at a stop, from its order and the surface temperature. */
export async function recommendedFor(client: unknown, saltOrderId: string, surfaceTempF: number, product: SaltProduct, pretreated: boolean) {
  const sb = untyped(client);
  const { data: order } = await sb.from("salt_orders").select("surface, area_sqft, organization_id").eq("id", saltOrderId).maybeSingle();
  const { data: organization } = order
    ? await sb.from("organizations").select("*").eq("id", (order as { organization_id: string }).organization_id).maybeSingle()
    : { data: null };
  const settings = saltSettingsFrom(organization as Record<string, unknown> | null);
  const o = order as { surface?: Surface; area_sqft?: number | null } | null;
  return recommendApplication({
    surfaceTempF,
    product,
    pretreated,
    areaSqft: o?.area_sqft ?? null,
    basePounds: o?.surface ? poundsFor(o.surface, settings) : null,
    bagPounds: settings.bagPounds,
  });
}

/**
 * Tell the client their property was serviced, once per stop.
 *
 * Only when the business has switched the notice on, and only for events
 * started after it did. Retried by the next log or close when it was held
 * for quiet hours.
 */
export async function notifyServiced(stopId: string, now = new Date()): Promise<boolean> {
  const admin = untyped(createAdminClient());
  const { data } = await admin
    .from("snow_event_stops")
    .select("id, organization_id, customer_id, status, serviced_at, proof_token, client_notified_at, snow_events(started_at)")
    .eq("id", stopId)
    .maybeSingle();
  const stop = data as {
    id: string;
    organization_id: string;
    customer_id: string | null;
    status: string;
    serviced_at: string | null;
    proof_token: string;
    client_notified_at: string | null;
    snow_events: { started_at: string | null } | null;
  } | null;
  if (!stop || stop.status !== "done" || !stop.serviced_at || stop.client_notified_at || !stop.customer_id) return false;

  const settings = await loadWeatherOpsSettings(admin, stop.organization_id);
  if (!settings.snowClientNotice || !coveredSince(settings.snowClientNoticeStartedAt, stop.snow_events?.started_at ?? null)) return false;

  const [contacts, { data: org }] = await Promise.all([
    contactsFor([stop.customer_id]),
    admin.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", stop.organization_id).maybeSingle(),
  ]);
  const contact = contacts.get(stop.customer_id);
  if (!contact) return false;
  const channel = contact.phone ? "sms" : "email";
  const outcome = await sendClientMessage(
    {
      organizationId: stop.organization_id,
      customerId: contact.id,
      channel,
      basis: "service",
      kind: "snow_serviced",
      referenceId: null,
      dedupeKey: servicedDedupeKey(stop.id, channel),
      subject: "Your property was serviced",
      body: servicedNotice({
        firstName: contact.name?.split(" ")[0] ?? null,
        business: (org as { name?: string } | null)?.name || "JS Landscaping",
        timeText: timeOnly(stop.serviced_at),
        proofUrl: proofUrlFor(stop.proof_token),
      }),
      automatic: true,
    },
    contact,
    quietWindowFor((org ?? {}) as Parameters<typeof quietWindowFor>[0]),
    now
  );
  const final = outcome.sent || (outcome.reason !== "quiet_hours" && outcome.reason !== "failed");
  if (final) await admin.from("snow_event_stops").update({ client_notified_at: now.toISOString() }).eq("id", stop.id);
  return outcome.sent;
}

export interface CloseOutcome {
  billed: number;
  billedCents: number;
  skipped: number;
  failed: number;
  prepaidDrawn: number;
  invoicingOff: boolean;
}

/**
 * Close a storm and settle it.
 *
 * Prepaid clients have their treatments drawn down. Contract clients are
 * billed by their contract, when per-event invoicing is switched on (or the
 * owner asks for this one event by hand). Every client gets one
 * snow_event_invoices row per event, and the unique key on it is what makes
 * closing twice, or a retry after a Stripe hiccup, bill nobody twice.
 */
export async function settleSnowEvent(eventId: string, opts: { force?: boolean } = {}): Promise<CloseOutcome> {
  const admin = untyped(createAdminClient());
  const outcome: CloseOutcome = { billed: 0, billedCents: 0, skipped: 0, failed: 0, prepaidDrawn: 0, invoicingOff: false };

  const { data: eventRow } = await admin.from("snow_events").select("id, organization_id, label, status, started_at, closed_at").eq("id", eventId).maybeSingle();
  const event = eventRow as { id: string; organization_id: string; label: string; status: string; started_at: string | null; closed_at: string | null } | null;
  if (!event || event.status !== "closed") throw new Error("Close the event before billing it.");

  const settings = await loadWeatherOpsSettings(admin, event.organization_id);
  const invoicingOn = opts.force || (settings.snowInvoicingEnabled && coveredSince(settings.snowInvoicingStartedAt, event.started_at));
  outcome.invoicingOff = !invoicingOn;

  const [{ data: stopRows }, clients, { data: existing }] = await Promise.all([
    admin.from("snow_event_stops").select(STOP_COLUMNS + ", customer_id, job_id").eq("event_id", eventId),
    listSaltClients(admin),
    admin.from("snow_event_invoices").select("salt_order_id, status").eq("event_id", eventId),
  ]);
  const settled = new Map(((existing ?? []) as { salt_order_id: string; status: string }[]).map((r) => [r.salt_order_id, r.status]));
  const byOrder = new Map(clients.map((c) => [c.id, c]));

  for (const raw of (stopRows ?? []) as unknown as Record<string, unknown>[]) {
    const stop = toStop(raw);
    const order = byOrder.get(stop.saltOrderId);
    if (!order) continue;
    // A row already settled stays settled; a failed one is tried again.
    const prior = settled.get(stop.saltOrderId);
    if (prior && prior !== "failed") continue;

    const logged: LoggedStop = {
      status: stop.status,
      servicedAt: stop.servicedAt,
      service: stop.service,
      pushes: stop.pushes,
      applications: stop.applications,
      saltLbs: stop.saltLbs,
      depthIn: stop.depthIn,
      photoCount: stop.photoPaths.length,
    };
    const when = stop.servicedAt ? `${weekdayDate(stop.servicedAt)} at ${timeOnly(stop.servicedAt)}` : null;
    const bill = snowBillFor(order.contract, logged, event.label, when);
    const base = {
      organization_id: event.organization_id,
      event_id: eventId,
      salt_order_id: order.id,
      customer_id: order.customerId,
      job_id: order.jobId,
      contract_type: order.contract.type,
      photo_paths: stop.photoPaths,
      detail: { stopId: stop.id, servicedAt: stop.servicedAt, pushes: stop.pushes, applications: stop.applications, saltLbs: stop.saltLbs, depthIn: stop.depthIn, proofToken: stop.proofToken },
    };

    if (!bill.bill) {
      // Written down either way, so the history says why nobody was billed.
      const { data: inserted } = await admin
        .from("snow_event_invoices")
        .upsert({ ...base, amount_cents: 0, description: bill.reason, status: "skipped", skip_reason: bill.reason }, { onConflict: "event_id,salt_order_id", ignoreDuplicates: true })
        .select("id");
      outcome.skipped += 1;
      // A prepaid treatment is drawn once, when its row is first written.
      if ((inserted ?? []).length > 0 && order.contract.type === "prepaid") {
        const draw = prepaidDraw(logged);
        if (draw > 0) {
          await admin.from("salt_orders").update({ treatments_used: Math.min(order.treatments, order.used + draw) }).eq("id", order.id);
          outcome.prepaidDrawn += draw;
        }
      }
      continue;
    }

    if (!invoicingOn) continue;

    const { data: claimed } = await admin
      .from("snow_event_invoices")
      .upsert({ ...base, amount_cents: bill.amountCents, description: bill.description, status: "draft" }, { onConflict: "event_id,salt_order_id", ignoreDuplicates: !prior })
      .select("id");
    const invoiceRowId = ((claimed ?? []) as { id: string }[])[0]?.id;
    if (!invoiceRowId) continue;

    if (!order.customerId) {
      await admin.from("snow_event_invoices").update({ status: "failed", error: "This order has no client record to bill. Place it on the map first." }).eq("id", invoiceRowId);
      outcome.failed += 1;
      continue;
    }
    try {
      const proofUrl = proofUrlFor(stop.proofToken);
      const invoice = await createSnowStripeInvoice({
        customerId: order.customerId,
        amountCents: bill.amountCents,
        description: bill.description,
        proofUrl,
        metadata: { snow_event_id: eventId, snow_event_invoice_id: invoiceRowId, salt_order_id: order.id },
      });
      await admin
        .from("snow_event_invoices")
        .update({
          status: "open",
          error: null,
          stripe_invoice_id: invoice.stripeInvoiceId,
          stripe_customer_id: invoice.stripeCustomerId,
          hosted_invoice_url: invoice.hostedUrl,
          invoice_pdf: invoice.pdf,
          sent_at: new Date().toISOString(),
        })
        .eq("id", invoiceRowId);
      outcome.billed += 1;
      outcome.billedCents += bill.amountCents;
      if (invoice.hostedUrl) await sendSnowInvoiceNotice(admin, event.organization_id, order.customerId, invoiceRowId, bill.description, invoice.hostedUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("snow.invoice_failed", err, { eventId, saltOrderId: order.id });
      await admin.from("snow_event_invoices").update({ status: "failed", error: message }).eq("id", invoiceRowId);
      outcome.failed += 1;
    }
  }

  if (invoicingOn) await admin.from("snow_events").update({ invoiced_at: new Date().toISOString() }).eq("id", eventId);
  return outcome;
}

async function sendSnowInvoiceNotice(admin: SupabaseClient, organizationId: string, customerId: string, invoiceRowId: string, description: string, link: string) {
  const [contacts, { data: org }] = await Promise.all([
    contactsFor([customerId]),
    admin.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", organizationId).maybeSingle(),
  ]);
  const contact = contacts.get(customerId);
  if (!contact) return;
  const channel = contact.email ? "email" : "sms";
  const business = (org as { name?: string } | null)?.name || "JS Landscaping";
  await sendClientMessage(
    {
      organizationId,
      customerId,
      channel,
      basis: "service",
      kind: "snow_invoice",
      referenceId: null,
      dedupeKey: `snow_invoice:${invoiceRowId}:${channel}`,
      subject: `${business}: snow service invoice`,
      body: `${description}.\n\nYour invoice, with the photos from each visit: ${link}`,
      automatic: true,
    },
    contact,
    quietWindowFor((org ?? {}) as Parameters<typeof quietWindowFor>[0])
  ).catch((err) => log.error("snow.invoice_notice_failed", err, { invoiceRowId }));
}

/**
 * Suggest a storm from the forecast, once per forecast day.
 *
 * Read for the shop's location: a snow route is one metro area, and the
 * shop is where the trucks leave from. Owners and project leads are texted
 * once when a new suggestion appears; nothing is started without a tap.
 */
export async function suggestSnowFromForecast(organizationId: string, now = new Date()): Promise<{ suggested: boolean; reason?: string }> {
  const admin = untyped(createAdminClient());
  const settings = await loadWeatherOpsSettings(admin, organizationId);
  if (!settings.snowSuggestEnabled) return { suggested: false, reason: "Snow suggestions are switched off." };

  const { data: shop } = await admin.from("business_locations").select("lat, lng").eq("organization_id", organizationId).limit(1).maybeSingle();
  const key = locationKeyFor((shop as { lat?: number } | null)?.lat, (shop as { lng?: number } | null)?.lng);
  if (!key) return { suggested: false, reason: "No business location is set." };

  const today = dateKeyIn(now);
  const forecast = await fetchCascadeForecast([pointFromKey(key)], today, 3, 0);
  const days = [...(forecast.get(key)?.values() ?? [])]
    .filter((d) => d.date >= today && d.date <= addDays(today, 2))
    .map((d) => ({ date: d.date, snowIn: d.snowIn, rainIn: d.rainIn, code: d.code, tempMinF: d.tempMinF, tempMaxF: d.tempMaxF }));
  const suggestion = suggestSnowEvent(days, settings.snowTriggerIn);
  if (!suggestion) return { suggested: false, reason: "Nothing in the forecast." };

  // A live storm already covers it.
  const { data: live } = await admin.from("snow_events").select("id").eq("organization_id", organizationId).eq("status", "active").limit(1);
  if ((live ?? []).length > 0) return { suggested: false, reason: "A snow event is already running." };

  const { data: inserted, error } = await admin
    .from("snow_events")
    .insert({
      organization_id: organizationId,
      status: "suggested",
      source: "forecast",
      service: suggestion.service,
      label: `${suggestion.service === "plow" ? "Snow" : "Ice"} ${weekdayDate(`${suggestion.date}T12:00:00`)}`,
      forecast_date: suggestion.date,
      forecast_snow_in: suggestion.snowIn,
      forecast_low_f: suggestion.lowF,
      forecast_note: suggestion.note,
    })
    .select("id")
    .maybeSingle();
  // The unique index on (organization, forecast day) turns a repeat into a no-op.
  if (error || !inserted) return { suggested: false, reason: error?.code === "23505" ? "Already suggested." : error?.message };

  const { data: people } = await admin.from("profiles").select("id, organization_id, profile_roles(role_name)").eq("organization_id", organizationId);
  for (const p of (people ?? []) as { id: string; profile_roles: { role_name: string }[] | null }[]) {
    const roles = (p.profile_roles ?? []).map((r) => r.role_name);
    if (!isOwnerLevel(roles) && !hasRole(roles, "project-lead")) continue;
    await notifyTeamMember(p.id, "team_messages", `Snow event suggested for ${weekdayDate(`${suggestion.date}T12:00:00`)}: ${suggestion.note} Start it from Operations › Projects › Snow.`, {
      dedupeKey: `snow_suggested:${(inserted as { id: string }).id}`,
      overridesKindPreference: true,
    }).catch(() => false);
  }
  return { suggested: true };
}
