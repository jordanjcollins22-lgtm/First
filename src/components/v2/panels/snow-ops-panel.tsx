import { Snowflake } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getSnowPanelData } from "@/lib/data/snow-panel";
import { CONTRACT_LABEL } from "@/lib/snow/billing";
import { PRODUCT_LABEL } from "@/lib/snow/application";
import { money } from "@/lib/salt";
import { monthDayTime, timeOnly, weekdayDate } from "@/lib/time-zone";
import {
  AddContractClient,
  BillNowButton,
  CloseEventForm,
  ContractEditor,
  SnowSettingsForm,
  StartEventButtons,
  SuggestionActions,
} from "@/components/v2/panels/snow-ops-client";
import { OpenEntity } from "@/components/v2/panels/ops-open";

/**
 * Operations › Projects: snow.
 *
 * One tap starts a storm and lays out the route from the salt clients on
 * file. The crew logs each stop on their phone (time, photo, GPS, surface
 * temperature, what went down); this panel watches the route fill in, and
 * when the storm is closed, prepaid treatments are drawn down and contract
 * clients are billed by their contract with the photos attached.
 */
export async function SnowOpsPanel() {
  const organizationId = await getCurrentOrganizationId();
  const [data, customers] = await Promise.all([
    getSnowPanelData(organizationId).catch((err) => {
      console.error("Snow panel failed to load:", err);
      return null;
    }),
    customerOptions(),
  ]);

  if (!data) {
    return <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Couldn&apos;t load snow operations just now. Reload the page.</section>;
  }

  const { settings, active } = data;
  const missingRates = data.clients.filter((c) => c.onRoute && c.missingRate);
  const unplaced = data.clients.filter((c) => c.onRoute && !c.customerId);
  const contractClients = data.clients.filter((c) => c.status !== "cancelled");

  return (
    <section className="grid gap-4" aria-labelledby="snow-panel-title">
      <header className="flex items-start gap-3">
        <Snowflake className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 id="snow-panel-title" className="text-lg font-bold">
            Snow and salt
          </h2>
          <p className="text-sm text-muted-foreground">Start a storm, watch the route, and bill each client by their contract when it&apos;s done.</p>
        </div>
      </header>

      {!data.ready && (
        <p className="rounded-xl border border-amber-400/60 bg-amber-50/70 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          The snow tables aren&apos;t set up yet (migration 0359). Nothing here will run until they are.
        </p>
      )}

      {/* Needs you */}
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">Needs you</h3>
        {data.suggestions.length === 0 && data.season.failedInvoices === 0 && missingRates.length === 0 && unplaced.length === 0 ? (
          <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">Nothing waiting.</p>
        ) : (
          <ul className="grid gap-2">
            {data.suggestions.map((s) => (
              <li key={s.id} className="rounded-xl border border-sky-400/60 bg-card p-3">
                <OpenEntity kind="ops.snow_event" id={s.id} className="text-sm font-semibold">
                  Forecast says go out {s.forecastDate ? weekdayDate(`${s.forecastDate}T12:00:00`) : "soon"}: {s.service === "plow" ? "plow and salt" : "salt"}
                </OpenEntity>
                {s.forecastNote && <p className="text-xs text-muted-foreground">{s.forecastNote}</p>}
                <SuggestionActions id={s.id} service={s.service as "salt" | "plow" | "pretreat"} disabled={Boolean(active)} />
              </li>
            ))}
            {data.season.failedInvoices > 0 && (
              <li className="rounded-xl border border-amber-400/60 bg-card p-3 text-sm">
                {data.season.failedInvoices} snow invoice{data.season.failedInvoices === 1 ? "" : "s"} couldn&apos;t be sent. The reason is on each one below; fix it and press &ldquo;Bill now&rdquo; on the event to retry.
              </li>
            )}
            {missingRates.length > 0 && (
              <li className="rounded-xl border border-amber-400/60 bg-card p-3 text-sm">
                {missingRates.length} contract client{missingRates.length === 1 ? " has" : "s have"} no rate set, so {missingRates.length === 1 ? "it" : "they"} won&apos;t be billed: {missingRates.map((c) => c.name).join(", ")}.
              </li>
            )}
            {unplaced.length > 0 && (
              <li className="rounded-xl border border-amber-400/60 bg-card p-3 text-sm">
                {unplaced.length} salt client{unplaced.length === 1 ? " has" : "s have"} no client record, so {unplaced.length === 1 ? "it" : "they"} can&apos;t be told or billed until each is matched to a client.
              </li>
            )}
          </ul>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="Route progress"
          value={active ? `${active.done}/${active.stops}` : "—"}
          target={active ? "Target: every stop logged" : "No storm running"}
          good={!active || active.done === active.stops}
        />
        <Kpi label="Storms this winter" value={String(data.season.events)} target={`${data.routeSize} on the route`} good />
        <Kpi label="Melt put down this winter" value={`${data.season.saltLbs.toLocaleString()} lb`} target="Logged per stop" good />
        <Kpi label="Billed this winter" value={money(data.season.billedCents)} target={settings.snowInvoicingEnabled ? "Billed on close" : "Invoicing is off"} good={settings.snowInvoicingEnabled} />
      </div>

      {/* The live storm, or the button to start one */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-2">
          <h3 className="text-sm font-semibold">
            {active ? (
              <OpenEntity kind="ops.snow_event" id={active.id}>
                Running: {active.label}
              </OpenEntity>
            ) : (
              "Start a snow event"
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {active
              ? `Started ${active.startedAt ? monthDayTime(active.startedAt) : ""}. The crew logs stops from the Snow route screen.`
              : `${data.routeSize} salt client${data.routeSize === 1 ? "" : "s"} will go on the route, in the office's order then by distance from the shop.`}
          </p>
        </div>
        {active ? (
          <>
            <ol className="divide-y">
              {active.stopList.map((s) => (
                <li key={s.id} className="grid gap-0.5 px-4 py-2 text-sm">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-muted-foreground">{s.position}.</span>
                    <span className="font-medium">{s.name}</span>
                    <StopBadge status={s.status} />
                    {s.servicedAt && <span className="text-xs text-muted-foreground">{timeOnly(s.servicedAt)}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.address}</span>
                  {s.status === "done" && (
                    <span className="text-xs text-muted-foreground">
                      {[
                        s.surfaceTempF != null ? `${s.surfaceTempF}°F surface` : null,
                        s.product ? PRODUCT_LABEL[s.product] : null,
                        s.saltLbs != null ? `${s.saltLbs} lb` : null,
                        s.recommendedLbs != null ? `(${s.recommendedLbs} lb advised)` : null,
                        s.pushes > 0 ? `${s.pushes} push${s.pushes === 1 ? "" : "es"}` : null,
                        `${s.photoPaths.length} photo${s.photoPaths.length === 1 ? "" : "s"}`,
                        s.gps ? "GPS" : "no GPS",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {s.status === "skipped" && s.skipReason && <span className="text-xs text-muted-foreground">Skipped: {s.skipReason}</span>}
                </li>
              ))}
            </ol>
            <div className="border-t p-4">
              <CloseEventForm eventId={active.id} pending={active.stops - active.done} />
            </div>
          </>
        ) : (
          <div className="p-4">
            <StartEventButtons disabled={!data.ready} />
          </div>
        )}
      </div>

      {/* History */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-2">
          <h3 className="text-sm font-semibold">Event history</h3>
        </div>
        {data.history.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No storms closed yet.</p>
        ) : (
          <ul className="divide-y">
            {data.history.map((e) => (
              <li key={e.id} className="grid gap-1 px-4 py-2 text-sm">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <OpenEntity kind="ops.snow_event" id={e.id} className="font-medium">
                    {e.label}
                  </OpenEntity>
                  <span className="text-xs text-muted-foreground">{e.closedAt ? monthDayTime(e.closedAt) : ""}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {e.done} of {e.stops} stops · {e.saltLbs} lb of melt · {money(e.billedCents)} billed
                  {e.invoicedAt ? "" : " · not billed"}
                </span>
                {!e.invoicedAt && <BillNowButton eventId={e.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invoices */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-2">
          <h3 className="text-sm font-semibold">Invoices this winter</h3>
          <p className="text-xs text-muted-foreground">Each carries the time of service and the photos. Seasonal and prepaid clients are logged, not billed.</p>
        </div>
        {data.invoices.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y">
            {data.invoices.map((inv) => (
              <li key={inv.id} className="grid gap-0.5 px-4 py-2 text-sm">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{inv.client}</span>
                  <span className="text-xs text-muted-foreground">{inv.eventLabel}</span>
                  <span className="ml-auto font-semibold tabular-nums">{inv.amountCents > 0 ? money(inv.amountCents) : "—"}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {CONTRACT_LABEL[inv.contractType as keyof typeof CONTRACT_LABEL] ?? inv.contractType} · {inv.status}
                  {inv.reason ? ` · ${inv.reason}` : ""} · {inv.photos} photo{inv.photos === 1 ? "" : "s"}
                  {inv.hostedUrl && (
                    <>
                      {" · "}
                      <a href={inv.hostedUrl} target="_blank" rel="noreferrer" className="underline">
                        open
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Contracts */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-2">
          <h3 className="text-sm font-semibold">Snow contracts</h3>
          <p className="text-xs text-muted-foreground">The terms each salt client is billed on. Prepaid is what the salt page sells; the rest are billed when a storm closes.</p>
        </div>
        {contractClients.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No salt clients yet.</p>
        ) : (
          <ul className="divide-y">
            {contractClients.map((c) => (
              <li key={c.id} className="px-4 py-2">
                <ContractEditor
                  client={{
                    id: c.id,
                    name: c.name,
                    address: c.address,
                    onRoute: c.onRoute,
                    missingRate: c.missingRate,
                    left: c.contract.type === "prepaid" ? Math.max(0, c.treatments - c.used) : null,
                    contractType: c.contract.type,
                    ratePerPush: c.contract.ratePerPushCents != null ? c.contract.ratePerPushCents / 100 : null,
                    ratePerApplication: c.contract.ratePerApplicationCents != null ? c.contract.ratePerApplicationCents / 100 : null,
                    ratePerEvent: c.contract.ratePerEventCents != null ? c.contract.ratePerEventCents / 100 : null,
                    seasonalPrice: c.contract.seasonalPriceCents != null ? c.contract.seasonalPriceCents / 100 : null,
                    triggerDepthIn: c.triggerDepthIn,
                    areaSqft: c.areaSqft,
                    includesPlowing: c.includesPlowing,
                    routeOrder: c.routeOrder,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="border-t p-4">
          <AddContractClient customers={customers} />
        </div>
      </div>

      <SnowSettingsForm
        ready={data.ready}
        settings={{
          snowSuggestEnabled: settings.snowSuggestEnabled,
          snowTriggerIn: settings.snowTriggerIn,
          snowClientNotice: settings.snowClientNotice,
          snowInvoicingEnabled: settings.snowInvoicingEnabled,
        }}
      />
    </section>
  );
}

async function customerOptions(): Promise<{ id: string; name: string }[]> {
  try {
    const sb = (await createClient()) as unknown as SupabaseClient;
    const { data } = await sb.from("customers").select("id, name").order("name").limit(500);
    return ((data ?? []) as { id: string; name: string | null }[]).map((c) => ({ id: c.id, name: c.name || "Unnamed client" }));
  } catch {
    return [];
  }
}

function StopBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
    skipped: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
    pending: "bg-muted text-muted-foreground",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? styles.pending}`}>{status === "pending" ? "to do" : status}</span>;
}

function Kpi({ label, value, target, good }: { label: string; value: string; target: string; good: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono text-2xl ${good ? "" : "text-amber-700 dark:text-amber-400"}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{target}</p>
    </div>
  );
}
