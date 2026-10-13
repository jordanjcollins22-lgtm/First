import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { dateKeyIn } from "@/lib/time-zone";
import { embeddedOne } from "@/lib/postgrest";
import { loadWeatherOpsSettings } from "@/lib/data/weather-cascade";
import { listSaltClients, onTheRoute, STOP_COLUMNS, toStop, type SaltClientRow, type SnowStop } from "@/lib/data/snow-ops";
import type { WeatherOpsSettings } from "@/lib/weather-cascade/settings";
import type { ContractType } from "@/lib/snow/billing";

/**
 * Everything the snow panel shows, read as the signed-in owner.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export interface SnowEventSummary {
  id: string;
  label: string;
  status: string;
  service: string;
  source: string;
  startedAt: string | null;
  closedAt: string | null;
  forecastDate: string | null;
  forecastNote: string | null;
  stops: number;
  done: number;
  saltLbs: number;
  billedCents: number;
  invoicedAt: string | null;
}

export interface SnowInvoiceRow {
  id: string;
  eventLabel: string;
  client: string;
  contractType: string;
  amountCents: number;
  status: string;
  reason: string | null;
  hostedUrl: string | null;
  photos: number;
  createdAt: string;
}

export interface SnowPanelData {
  settings: WeatherOpsSettings;
  ready: boolean;
  suggestions: SnowEventSummary[];
  active: (SnowEventSummary & { stopList: SnowStop[] }) | null;
  history: SnowEventSummary[];
  invoices: SnowInvoiceRow[];
  clients: (SaltClientRow & { onRoute: boolean; missingRate: boolean })[];
  routeSize: number;
  season: { events: number; saltLbs: number; billedCents: number; failedInvoices: number };
}

/** The winter a date falls in starts on the first of July before it. */
function seasonStart(now: Date): string {
  const year = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${year}-07-01T00:00:00Z`;
}

export function missingRate(c: SaltClientRow): boolean {
  const t: ContractType = c.contract.type;
  if (t === "per_push") return !c.contract.ratePerPushCents;
  if (t === "per_application") return !c.contract.ratePerApplicationCents;
  if (t === "per_event") return !c.contract.ratePerEventCents;
  if (t === "seasonal") return !c.contract.seasonalPriceCents;
  return false;
}

export async function getSnowPanelData(organizationId: string): Promise<SnowPanelData> {
  const sb = untyped(await createClient());
  const settings = await loadWeatherOpsSettings(sb, organizationId);
  const now = new Date();
  const today = dateKeyIn(now);
  const empty: SnowPanelData = {
    settings,
    ready: false,
    suggestions: [],
    active: null,
    history: [],
    invoices: [],
    clients: [],
    routeSize: 0,
    season: { events: 0, saltLbs: 0, billedCents: 0, failedInvoices: 0 },
  };

  const { data: eventRows, error } = await sb
    .from("snow_events")
    .select("id, label, status, service, source, started_at, closed_at, forecast_date, forecast_note, invoiced_at, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return empty;

  const events = (eventRows ?? []) as Record<string, unknown>[];
  const eventIds = events.map((e) => String(e.id));
  const since = seasonStart(now);
  const [{ data: stopRows }, { data: invoiceRows }, clients] = await Promise.all([
    eventIds.length > 0 ? sb.from("snow_event_stops").select(STOP_COLUMNS).in("event_id", eventIds).order("position") : Promise.resolve({ data: [] }),
    sb
      .from("snow_event_invoices")
      .select("id, event_id, contract_type, amount_cents, status, skip_reason, error, hosted_invoice_url, photo_paths, created_at, salt_orders(name)")
      .eq("organization_id", organizationId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
    listSaltClients(sb, organizationId).catch(() => [] as SaltClientRow[]),
  ]);

  const stops = ((stopRows ?? []) as unknown as Record<string, unknown>[]).map(toStop);
  const stopsByEvent = new Map<string, SnowStop[]>();
  for (const s of stops) {
    const list = stopsByEvent.get(s.eventId) ?? [];
    list.push(s);
    stopsByEvent.set(s.eventId, list);
  }
  const invoices = (invoiceRows ?? []) as Record<string, unknown>[];
  const billedByEvent = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status === "open" || inv.status === "paid") {
      billedByEvent.set(String(inv.event_id), (billedByEvent.get(String(inv.event_id)) ?? 0) + Number(inv.amount_cents ?? 0));
    }
  }

  const summarise = (e: Record<string, unknown>): SnowEventSummary => {
    const list = stopsByEvent.get(String(e.id)) ?? [];
    return {
      id: String(e.id),
      label: String(e.label),
      status: String(e.status),
      service: String(e.service),
      source: String(e.source),
      startedAt: (e.started_at as string | null) ?? null,
      closedAt: (e.closed_at as string | null) ?? null,
      forecastDate: (e.forecast_date as string | null) ?? null,
      forecastNote: (e.forecast_note as string | null) ?? null,
      stops: list.length,
      done: list.filter((s) => s.status === "done").length,
      saltLbs: Math.round(list.reduce((sum, s) => sum + (s.saltLbs ?? 0), 0) * 10) / 10,
      billedCents: billedByEvent.get(String(e.id)) ?? 0,
      invoicedAt: (e.invoiced_at as string | null) ?? null,
    };
  };

  const labelByEvent = new Map(events.map((e) => [String(e.id), String(e.label)]));
  const activeRow = events.find((e) => e.status === "active");
  const closedThisSeason = events.filter((e) => e.status === "closed" && String(e.started_at ?? e.created_at) >= since).map(summarise);

  const withFlags = clients.map((c) => ({ ...c, onRoute: onTheRoute(c, now), missingRate: missingRate(c) }));

  return {
    settings,
    ready: true,
    suggestions: events.filter((e) => e.status === "suggested" && (!e.forecast_date || String(e.forecast_date) >= today)).map(summarise),
    active: activeRow ? { ...summarise(activeRow), stopList: stopsByEvent.get(String(activeRow.id)) ?? [] } : null,
    history: events.filter((e) => e.status === "closed").slice(0, 10).map(summarise),
    invoices: invoices.slice(0, 30).map((inv) => ({
      id: String(inv.id),
      eventLabel: labelByEvent.get(String(inv.event_id)) ?? "Snow event",
      client: embeddedOne(inv.salt_orders as { name: string } | null)?.name ?? "Client",
      contractType: String(inv.contract_type),
      amountCents: Number(inv.amount_cents ?? 0),
      status: String(inv.status),
      reason: (inv.error as string | null) ?? (inv.skip_reason as string | null) ?? null,
      hostedUrl: (inv.hosted_invoice_url as string | null) ?? null,
      photos: ((inv.photo_paths as string[] | null) ?? []).length,
      createdAt: String(inv.created_at),
    })),
    clients: withFlags,
    routeSize: withFlags.filter((c) => c.onRoute).length,
    season: {
      events: closedThisSeason.length + (activeRow ? 1 : 0),
      saltLbs: Math.round(closedThisSeason.reduce((sum, e) => sum + e.saltLbs, 0) + (activeRow ? summarise(activeRow).saltLbs : 0)),
      billedCents: invoices.filter((i) => i.status === "open" || i.status === "paid").reduce((sum, i) => sum + Number(i.amount_cents ?? 0), 0),
      failedInvoices: invoices.filter((i) => i.status === "failed").length,
    },
  };
}
