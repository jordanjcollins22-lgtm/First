"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealProfile } from "@/lib/data/team";
import { canRunJobs, hasRole, isOwnerLevel } from "@/lib/roles";
import { loadWeatherOpsSettings } from "@/lib/data/weather-cascade";
import { notifyServiced, recommendedFor, settleSnowEvent, SNOW_PHOTO_BUCKET, startSnowEvent } from "@/lib/data/snow-ops";
import { PRODUCTS, type ApplicationAdvice, type SaltProduct } from "@/lib/snow/application";
import { isContractType, type ContractType } from "@/lib/snow/billing";
import { MINIMUM_TREATMENTS } from "@/lib/salt";

/**
 * Snow operations: start a storm, log the stops, close it, and the contract
 * terms each salt client is billed on.
 *
 * Starting and closing an event is the owner's or a project lead's call.
 * Logging a stop is anybody on the crew. Contract terms and the switches are
 * the owner's, because they are prices and messages to clients.
 */

export type SnowActionResult<T = null> = { ok: true; message: string; value?: T } | { ok: false; error: string };

const untyped = (c: unknown) => c as SupabaseClient;

function refresh() {
  revalidatePath("/v2", "layout");
  revalidatePath("/snow");
  revalidatePath("/admin/salt");
}

/** Anybody who works the route: owners, leads, account managers and crew. */
function onTheCrew(roles: readonly string[]): boolean {
  return canRunJobs(roles) || hasRole(roles, "project-technician");
}

export async function startSnowEventAction(input: { service: "pretreat" | "salt" | "plow"; label?: string; suggestionId?: string | null }): Promise<SnowActionResult> {
  const me = await getRealProfile();
  if (!me || !canRunJobs(me.roles)) return { ok: false, error: "Only an owner or project lead can start a snow event." };
  if (!["pretreat", "salt", "plow"].includes(input.service)) return { ok: false, error: "Pick pre-treat, salt or plow." };
  try {
    const { stops } = await startSnowEvent(await createClient(), {
      organizationId: me.organization_id,
      by: me.id,
      service: input.service,
      label: input.label ?? null,
      suggestionId: input.suggestionId ?? null,
    });
    refresh();
    return { ok: true, message: stops > 0 ? `Started. ${stops} stops on the route.` : "Started, but no salt clients are on the route yet." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't start the event." };
  }
}

export async function dismissSnowSuggestion(id: string): Promise<SnowActionResult> {
  const me = await getRealProfile();
  if (!me || !canRunJobs(me.roles)) return { ok: false, error: "Only an owner or project lead can dismiss it." };
  const { error } = await untyped(await createClient()).from("snow_events").update({ status: "dismissed" }).eq("id", id).eq("status", "suggested");
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: "Dismissed." };
}

export async function closeSnowEventAction(eventId: string, measuredDepthIn?: number | null): Promise<SnowActionResult> {
  const me = await getRealProfile();
  if (!me || !canRunJobs(me.roles)) return { ok: false, error: "Only an owner or project lead can close a snow event." };
  const supabase = untyped(await createClient());
  const { data, error } = await supabase
    .from("snow_events")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: me.id,
      measured_depth_in: measuredDepthIn != null && Number.isFinite(measuredDepthIn) && measuredDepthIn >= 0 ? measuredDepthIn : null,
    })
    .eq("id", eventId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That event isn't running." };
  try {
    const r = await settleSnowEvent(eventId);
    refresh();
    const parts = [`Closed.`];
    if (r.prepaidDrawn > 0) parts.push(`${r.prepaidDrawn} prepaid treatment${r.prepaidDrawn === 1 ? "" : "s"} drawn down.`);
    if (r.billed > 0) parts.push(`${r.billed} invoice${r.billed === 1 ? "" : "s"} sent, $${(r.billedCents / 100).toFixed(2)}.`);
    if (r.failed > 0) parts.push(`${r.failed} couldn't be billed; see the list.`);
    if (r.invoicingOff) parts.push("Per-event invoicing is off, so contract clients weren't billed.");
    return { ok: true, message: parts.join(" ") };
  } catch (err) {
    refresh();
    return { ok: false, error: `Closed, but settling it failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Bill one closed event by hand: the owner's explicit one-off, whatever the switch says. Also retries failures. */
export async function billSnowEventNow(eventId: string): Promise<SnowActionResult> {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return { ok: false, error: "Only an owner can send invoices." };
  const { data } = await untyped(await createClient()).from("snow_events").select("id").eq("id", eventId).maybeSingle();
  if (!data) return { ok: false, error: "That event isn't yours." };
  try {
    const r = await settleSnowEvent(eventId, { force: true });
    refresh();
    return { ok: true, message: `${r.billed} invoice${r.billed === 1 ? "" : "s"} sent${r.failed > 0 ? `, ${r.failed} failed` : ""}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't bill it." };
  }
}

export interface SnowSettingsInput {
  snowSuggestEnabled: boolean;
  snowTriggerIn: number;
  snowClientNotice: boolean;
  snowInvoicingEnabled: boolean;
}

export async function saveSnowSettings(input: SnowSettingsInput): Promise<SnowActionResult> {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return { ok: false, error: "Only an owner can change these." };
  const supabase = untyped(await createClient());
  const current = await loadWeatherOpsSettings(supabase, me.organization_id);
  if (!current.ready) return { ok: false, error: "The snow tables aren't set up yet. Ask for migration 0359 to be applied." };
  const now = new Date().toISOString();
  const trigger = Number(input.snowTriggerIn);
  const { error } = await supabase.from("weather_ops_settings").upsert(
    {
      organization_id: me.organization_id,
      snow_suggest_enabled: input.snowSuggestEnabled,
      snow_suggest_started_at: current.snowSuggestStartedAt ?? (input.snowSuggestEnabled ? now : null),
      snow_trigger_in: Number.isFinite(trigger) && trigger > 0 ? Math.min(24, trigger) : 1,
      snow_client_notice: input.snowClientNotice,
      snow_client_notice_started_at: current.snowClientNoticeStartedAt ?? (input.snowClientNotice ? now : null),
      snow_invoicing_enabled: input.snowInvoicingEnabled,
      snow_invoicing_started_at: current.snowInvoicingStartedAt ?? (input.snowInvoicingEnabled ? now : null),
      updated_at: now,
      updated_by: me.id,
    },
    { onConflict: "organization_id" }
  );
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: "Saved." };
}

/* -------------------------------------------------------------------------
 * Contracts
 * ---------------------------------------------------------------------- */

export interface SnowContractInput {
  contractType: ContractType;
  ratePerPush: number | null;
  ratePerApplication: number | null;
  ratePerEvent: number | null;
  seasonalPrice: number | null;
  triggerDepthIn: number | null;
  areaSqft: number | null;
  includesPlowing: boolean;
  routeOrder: number | null;
}

const cents = (dollars: number | null) => (dollars != null && Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null);
const positive = (n: number | null) => (n != null && Number.isFinite(n) && n > 0 ? n : null);

function contractPatch(input: SnowContractInput) {
  return {
    contract_type: input.contractType,
    rate_per_push_cents: cents(input.ratePerPush),
    rate_per_application_cents: cents(input.ratePerApplication),
    rate_per_event_cents: cents(input.ratePerEvent),
    seasonal_price_cents: cents(input.seasonalPrice),
    trigger_depth_in: positive(input.triggerDepthIn),
    area_sqft: positive(input.areaSqft) != null ? Math.round(input.areaSqft as number) : null,
    includes_plowing: input.includesPlowing,
    route_order: input.routeOrder != null && Number.isFinite(input.routeOrder) ? Math.round(input.routeOrder) : null,
  };
}

/** The terms on an existing salt client. */
export async function saveSnowContract(saltOrderId: string, input: SnowContractInput): Promise<SnowActionResult> {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return { ok: false, error: "Only an owner can set contract prices." };
  if (!isContractType(input.contractType)) return { ok: false, error: "Pick a contract type." };
  const { data, error } = await untyped(await createClient()).from("salt_orders").update(contractPatch(input)).eq("id", saltOrderId).select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Couldn't find that salt client." };
  refresh();
  return { ok: true, message: "Contract saved." };
}

/**
 * A snow contract for a client who has no salt order yet: a commercial lot
 * signed on paper, say. It goes on the same table as every other salt
 * client, so the route and the buying list see it. Recorded as not paid,
 * because no money was taken through the salt page; the contract bills it.
 */
export async function addSnowContractClient(input: SnowContractInput & { customerId: string }): Promise<SnowActionResult> {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return { ok: false, error: "Only an owner can add a contract." };
  if (!isContractType(input.contractType) || input.contractType === "prepaid") return { ok: false, error: "Prepaid clients sign up on the salt page. Pick a contract type." };
  const supabase = untyped(await createClient());
  const { data: customer } = await supabase.from("customers").select("id, name, email, phone, organization_id").eq("id", input.customerId).maybeSingle();
  if (!customer || (customer as { organization_id: string }).organization_id !== me.organization_id) return { ok: false, error: "Couldn't find that client." };
  const { data: property } = await supabase.from("properties").select("id, address, lat, lng").eq("customer_id", input.customerId).limit(1).maybeSingle();
  const patch = contractPatch(input);
  // The salt order's own columns need a price and three treatments; these
  // are the contract's headline rate, kept only to satisfy them.
  const headline = patch.seasonal_price_cents ?? patch.rate_per_event_cents ?? patch.rate_per_push_cents ?? patch.rate_per_application_cents;
  if (!headline) return { ok: false, error: "Set the contract's rate first." };
  const c = customer as { id: string; name: string | null; email: string | null; phone: string | null };
  const p = property as { id: string; address: string | null; lat: number | null; lng: number | null } | null;
  const { error } = await supabase.from("salt_orders").insert({
    organization_id: me.organization_id,
    name: c.name ?? "Client",
    email: c.email ?? "",
    phone: c.phone,
    address: p?.address ?? "",
    lat: p?.lat ?? null,
    lng: p?.lng ?? null,
    surface: "both",
    pet_friendly: false,
    treatments: MINIMUM_TREATMENTS,
    per_treatment_cents: headline,
    amount_cents: headline,
    status: "unpaid",
    customer_id: c.id,
    property_id: p?.id ?? null,
    note: "Snow contract added from Operations › Projects.",
    ...patch,
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: "Contract client added to the snow route." };
}

/* -------------------------------------------------------------------------
 * The crew's side: logging a stop
 * ---------------------------------------------------------------------- */

async function stopInOrg(supabase: SupabaseClient, stopId: string) {
  const { data } = await supabase
    .from("snow_event_stops")
    .select("id, event_id, salt_order_id, photo_paths, status, snow_events(status)")
    .eq("id", stopId)
    .maybeSingle();
  return data as { id: string; event_id: string; salt_order_id: string; photo_paths: string[]; status: string; snow_events: { status: string } | null } | null;
}

/** What to put down here, for the number on the crew's screen. */
export async function snowRecommendation(stopId: string, surfaceTempF: number, product: SaltProduct, pretreated: boolean): Promise<SnowActionResult<ApplicationAdvice>> {
  const me = await getRealProfile();
  if (!me || !onTheCrew(me.roles)) return { ok: false, error: "Sign in as crew first." };
  if (!Number.isFinite(surfaceTempF) || !PRODUCTS.includes(product)) return { ok: false, error: "Enter the surface temperature." };
  const supabase = untyped(await createClient());
  const stop = await stopInOrg(supabase, stopId);
  if (!stop) return { ok: false, error: "That stop isn't on your route." };
  const advice = await recommendedFor(supabase, stop.salt_order_id, surfaceTempF, product, pretreated);
  return { ok: true, message: advice.note, value: advice };
}

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** A place for one photo, uploaded straight from the phone. */
export async function snowStopPhotoSlot(stopId: string, type: string, size: number): Promise<SnowActionResult<{ path: string; token: string }>> {
  const me = await getRealProfile();
  if (!me || !onTheCrew(me.roles)) return { ok: false, error: "Sign in as crew first." };
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return { ok: false, error: "That isn't a photo we can open. Try a JPEG or PNG." };
  if (!(size > 0) || size > MAX_PHOTO_BYTES) return { ok: false, error: "That photo is too big. Try a smaller one." };
  const stop = await stopInOrg(untyped(await createClient()), stopId);
  if (!stop) return { ok: false, error: "That stop isn't on your route." };
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `snow/${stop.event_id}/${stop.id}-${randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(SNOW_PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Couldn't make room for the photo. Try again." };
  return { ok: true, message: "Ready.", value: { path, token: data.token } };
}

export interface LogStopInput {
  status: "done" | "skipped";
  surfaceTempF: number | null;
  depthIn: number | null;
  service: "pretreat" | "salt" | "plow" | "plow_and_salt";
  product: SaltProduct;
  saltLbs: number | null;
  saltBags: number | null;
  brineGallons: number | null;
  pushes: number;
  applications: number;
  pretreated: boolean;
  photoPaths: string[];
  gps: { lat: number; lng: number; accuracyM: number | null } | null;
  note: string | null;
  skipReason: string | null;
}

const num = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? n : null);
const nonNeg = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n >= 0 ? n : null);

/**
 * The stop, logged: the time is stamped by the server, not typed, because a
 * timestamp somebody can edit is not proof of anything.
 */
export async function logSnowStop(stopId: string, input: LogStopInput): Promise<SnowActionResult> {
  const me = await getRealProfile();
  if (!me || !onTheCrew(me.roles)) return { ok: false, error: "Sign in as crew first." };
  const supabase = untyped(await createClient());
  const stop = await stopInOrg(supabase, stopId);
  if (!stop) return { ok: false, error: "That stop isn't on your route." };
  if (stop.snow_events?.status !== "active") return { ok: false, error: "This snow event has been closed." };
  if (input.status === "skipped" && !input.skipReason?.trim()) return { ok: false, error: "Say why it was skipped." };
  if (input.status === "done" && input.photoPaths.length === 0 && stop.photo_paths.length === 0) {
    return { ok: false, error: "Add at least one photo: it's the client's proof we came." };
  }
  if (!PRODUCTS.includes(input.product)) return { ok: false, error: "Pick what was put down." };
  if (!["pretreat", "salt", "plow", "plow_and_salt"].includes(input.service)) return { ok: false, error: "Pick what was done." };

  // Only photos uploaded into this stop's own folder are accepted.
  const prefix = `snow/${stop.event_id}/${stop.id}-`;
  const photos = [...new Set([...stop.photo_paths, ...input.photoPaths.filter((p) => typeof p === "string" && p.startsWith(prefix))])].slice(0, 12);

  const temp = num(input.surfaceTempF);
  const advice = temp != null ? await recommendedFor(supabase, stop.salt_order_id, temp, input.product, input.pretreated).catch(() => null) : null;

  const { error } = await supabase
    .from("snow_event_stops")
    .update({
      status: input.status,
      // Stamped once. Correcting the pounds on a stop already logged keeps
      // the time it was actually done.
      serviced_at: input.status === "done" ? (stop.status === "done" ? undefined : new Date().toISOString()) : null,
      logged_by: me.id,
      gps_lat: num(input.gps?.lat),
      gps_lng: num(input.gps?.lng),
      gps_accuracy_m: nonNeg(input.gps?.accuracyM),
      surface_temp_f: temp,
      depth_in: nonNeg(input.depthIn),
      service: input.service,
      product: input.product,
      salt_lbs: nonNeg(input.saltLbs),
      salt_bags: nonNeg(input.saltBags),
      brine_gallons: nonNeg(input.brineGallons),
      pushes: Math.max(0, Math.round(input.pushes || 0)),
      applications: Math.max(0, Math.round(input.applications || 0)),
      recommended_lbs: advice?.pounds ?? null,
      photo_paths: photos,
      note: input.note?.trim() || null,
      skip_reason: input.status === "skipped" ? input.skipReason?.trim() ?? null : null,
    })
    .eq("id", stopId);
  if (error) return { ok: false, error: error.message };

  if (input.status === "done") await notifyServiced(stopId).catch(() => false);
  refresh();
  return { ok: true, message: input.status === "done" ? "Logged. On to the next one." : "Skipped." };
}
