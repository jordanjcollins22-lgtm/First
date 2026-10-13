import type { ActionResult, EntityAction, EntityHandler, EntityRow } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import { cents, dayLabel, parseNumber, spanLabel, stampLabel, toResult, words } from "@/lib/entities/ops-helpers";
import { jobNames, many, own, str } from "@/lib/entities/handlers/ops/common";

import { billSnowEventNow, closeSnowEventAction, dismissSnowSuggestion, startSnowEventAction } from "@/lib/actions/snow-actions";
import { applyWeatherProposal, dismissWeatherProposal } from "@/lib/actions/weather-actions";

/** Storms and rain: a snow event and its route, and a visit the weather moved. */

const NOT_YOURS: ActionResult = { ok: false, error: "That isn't one of yours." };
const SERVICE: Record<string, string> = { pretreat: "Pre-treat", salt: "Salt", plow: "Plow and salt" };

/* ------------------------------------------------------------ snow event */

const snowEvent: EntityHandler = {
  kind: "ops.snow_event",

  async load(ctx, id) {
    const e = await own(ctx, "snow_events", "id, label, status, service, source, started_at, closed_at, forecast_date, forecast_snow_in, forecast_note, measured_depth_in, invoiced_at, note", id);
    if (!e) return null;
    const [stops, invoices] = await Promise.all([
      many(ctx, "snow_event_stops", "id, position, name, address, status, serviced_at, salt_lbs, skip_reason, job_id", (q) => q.eq("event_id", id).order("position")),
      many(ctx, "snow_event_invoices", "id, amount_cents, status, contract_type, error, salt_orders(name)", (q) => q.eq("event_id", id)),
    ]);
    const status = str(e.status);
    const done = stops.filter((s) => s.status === "done").length;
    const actions: EntityAction[] = [];
    if (status === "suggested") {
      actions.push({ id: "start", label: "Start this storm", tone: "primary", confirm: "Start the snow event and lay out the route?" });
      actions.push({ id: "dismiss", label: "Not going out", tone: "danger", confirm: "Dismiss this forecast suggestion?" });
    }
    if (status === "active") {
      actions.push({
        id: "close",
        label: "Close the storm",
        tone: "primary",
        confirm: stops.length > done ? `${stops.length - done} stops aren't logged. Close anyway?` : "Close this storm and settle it?",
        input: { type: "number", label: "Snow depth measured, inches (optional)" },
      });
    }
    if (status === "closed" && !e.invoiced_at) actions.push({ id: "bill", label: "Bill now", confirm: "Send this storm's invoices to the contract clients now?" });

    const stopRows: EntityRow[] = stops.map((s) => {
      const text = `${s.position}. ${str(s.name)} · ${s.status === "pending" ? "to do" : str(s.status)}${s.serviced_at ? ` ${stampLabel(s.serviced_at)}` : ""}${s.salt_lbs != null ? ` · ${s.salt_lbs} lb` : ""}${s.skip_reason ? ` · ${str(s.skip_reason)}` : ""}`;
      return s.job_id ? row(text, "ops.job", s.job_id) : { text };
    });
    return {
      title: str(e.label) || "Snow event",
      subtitle: SERVICE[str(e.service)] ?? words(e.service),
      status: status === "active" ? `Running · ${done}/${stops.length}` : words(status),
      fields: [
        ...(e.forecast_date ? [{ label: "Forecast for", value: `${dayLabel(e.forecast_date)}${e.forecast_snow_in != null ? ` · ${e.forecast_snow_in}" expected` : ""}` }] : []),
        ...(e.forecast_note ? [{ label: "Forecast", value: str(e.forecast_note) }] : []),
        { label: "Started", value: e.started_at ? stampLabel(e.started_at) : "Not yet" },
        { label: "Closed", value: e.closed_at ? stampLabel(e.closed_at) : "" },
        { label: "Measured depth", value: e.measured_depth_in != null ? `${e.measured_depth_in}"` : "" },
        { label: "Billed", value: e.invoiced_at ? stampLabel(e.invoiced_at) : status === "closed" ? "Not yet" : "" },
        { label: "Note", value: str(e.note) },
      ],
      sections: [
        { title: "Route", rows: stopRows, empty: "No stops on the route." },
        {
          title: "Invoices",
          rows: invoices.map((inv) => ({ text: `${str((inv.salt_orders as { name?: string } | null)?.name) || "Client"} · ${Number(inv.amount_cents) > 0 ? cents(inv.amount_cents) : "—"} · ${words(inv.status)}${inv.error ? ` · ${str(inv.error)}` : ""}` })),
          empty: "None yet.",
        },
      ],
      actions,
      note: status === "active" ? "The crew logs each stop from their phone; closing draws down prepaid treatments and bills contract clients." : undefined,
    };
  },

  async act(ctx, id, action, value) {
    const e = await own(ctx, "snow_events", "id, status, service", id);
    if (!e) return NOT_YOURS;
    switch (action) {
      case "start": {
        const service = (["pretreat", "salt", "plow"].includes(str(e.service)) ? str(e.service) : "salt") as "pretreat" | "salt" | "plow";
        return toResult(await startSnowEventAction({ service, suggestionId: id }));
      }
      case "dismiss":
        return toResult(await dismissSnowSuggestion(id));
      case "close": {
        const depth = parseNumber(value);
        if (depth != null && (Number.isNaN(depth) || depth < 0)) return { ok: false, error: "Depth is a number of inches, or blank." };
        return toResult(await closeSnowEventAction(id, depth));
      }
      case "bill":
        return toResult(await billSnowEventNow(id));
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ------------------------------------------------------------ weather move */

const MOVE_COLS = "id, status, reason, cause, work_type, chain_key, run_key, from_starts_on, from_ends_on, to_starts_on, to_ends_on, work_session_id, job_id, created_at, applied_at, clients_notified_at, crew_notified_at, failure";

const weatherMove: EntityHandler = {
  kind: "ops.weather_move",

  async load(ctx, id) {
    const m = await own(ctx, "weather_reschedules", MOVE_COLS, id);
    if (!m) return null;
    const chain = await many(ctx, "weather_reschedules", "id, job_id, from_starts_on, to_starts_on, cause, status", (q) =>
      q.eq("chain_key", m.chain_key).eq("run_key", m.run_key).order("from_starts_on")
    );
    const names = await jobNames(ctx, [m.job_id, ...chain.map((c) => c.job_id)]);
    const proposed = m.status === "proposed";
    return {
      title: `${names.get(str(m.job_id)) ?? "Work day"} · ${dayLabel(m.from_starts_on)} → ${dayLabel(m.to_starts_on)}`,
      subtitle: str(m.reason),
      status: proposed ? "Waiting on you" : m.status === "applied" ? "Moved" : words(m.status),
      fields: [
        { label: "Was", value: spanLabel(m.from_starts_on, m.from_ends_on) },
        { label: "Now", value: spanLabel(m.to_starts_on, m.to_ends_on) },
        { label: "Why", value: m.cause === "chain" ? `Pushed along by an earlier move · ${str(m.reason)}` : str(m.reason) },
        { label: "Kind of work", value: words(m.work_type) },
        { label: "Moved", value: m.applied_at ? stampLabel(m.applied_at) : "" },
        { label: "Client told", value: m.clients_notified_at ? stampLabel(m.clients_notified_at) : proposed ? "" : "Not yet" },
        { label: "Crew told", value: m.crew_notified_at ? stampLabel(m.crew_notified_at) : "" },
        ...(m.failure ? [{ label: "Couldn't move", value: str(m.failure) }] : []),
      ],
      sections: [
        { title: "The work day", rows: [row(spanLabel(m.to_starts_on, m.to_ends_on), "ops.work_day", m.work_session_id), row(names.get(str(m.job_id)) ?? "Job", "ops.job", m.job_id)] },
        {
          title: "Moved together",
          rows: chain.filter((c) => c.id !== id).map((c) => row(`${names.get(str(c.job_id)) ?? "Work day"} · ${dayLabel(c.from_starts_on)} → ${dayLabel(c.to_starts_on)} · ${words(c.status)}`, "ops.weather_move", c.id)),
          empty: "Nothing else moved with it.",
        },
      ],
      actions: proposed
        ? [
            { id: "apply", label: chain.length > 1 ? `Make all ${chain.filter((c) => c.status === "proposed").length} moves` : "Make the move", tone: "primary", confirm: "Move these visits? Clients and crew are told." },
            { id: "dismiss", label: "Keep as booked", tone: "danger", confirm: "Keep these days as booked?" },
          ]
        : [],
      note: proposed ? "This went over the cascade's limits, so it waits for a person. The whole chain moves or none of it." : undefined,
    };
  },

  async act(ctx, id, action) {
    const m = await own(ctx, "weather_reschedules", "id, chain_key, run_key, status", id);
    if (!m) return NOT_YOURS;
    const ids = (await many(ctx, "weather_reschedules", "id", (q) => q.eq("chain_key", m.chain_key).eq("run_key", m.run_key).eq("status", "proposed"))).map((r) => str(r.id));
    if (!ids.length) return { ok: false, error: "That has already been decided." };
    if (action === "apply") return toResult(await applyWeatherProposal(ids));
    if (action === "dismiss") return toResult(await dismissWeatherProposal(ids));
    return { ok: false, error: "Unknown action." };
  },
};

export const OPS_WEATHER_HANDLERS: EntityHandler[] = [snowEvent, weatherMove];
