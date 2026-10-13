import type { EntityAction, EntityContext, EntityHandler, EntityRow } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import { findProvider } from "@/lib/integrations/catalog";
import { listIntegrations } from "@/lib/integrations/store";
import { listAppConnections } from "@/lib/data/app-connections";
import { disconnectIntegrationAction, saveIntegrationAction, testIntegrationAction } from "@/lib/actions/integration-actions";
import { setBusinessDetails } from "@/lib/actions/business-actions";
import { deleteBusinessLocation, updateBusinessLocation } from "@/lib/actions/location-actions";
import { acceptServiceType, denyServiceType, updateServicePricing } from "@/lib/actions/service-pricing-actions";
import { confirmObligationDate, markObligationDone, openDoc, saveObligation, type ObligationInput } from "@/lib/actions/back-office-actions";
import { KIND_LABEL, creditsShort, type ObligationKind, type Recurrence } from "@/lib/compliance/calendar";
import { day, isIsoDate, usd, usdExact, words } from "@/lib/entities/handlers/admin-format";
import { UNKNOWN, attempt, fields, many, num, one, personName, result, str, type Row } from "@/lib/entities/handlers/admin-common";

/**
 * The Admin page's settings: each integration as its card, the business
 * itself and its locations, the services on file, and the compliance
 * calendar's obligations.
 */

const STATUS_WORDS: Record<string, string> = { connected: "Connected", error: "Not working", not_connected: "Not connected", configured: "Configured", partial: "Partly set", missing: "Missing" };

/** Extra lines some wired-in connections carry: the sending domains, the banks, the last sync. */
async function connectionExtras(ctx: EntityContext, id: string): Promise<{ title: string; rows: EntityRow[] } | null> {
  const org = ctx.organizationId;
  if (id === "resend") {
    const domains = await many(ctx.sb.from("email_domains").select("hostname, status, last_checked_at").eq("organization_id", org));
    return { title: "Sending domains", rows: domains.map((d) => ({ text: `${str(d.hostname)} · ${words(str(d.status))}${d.last_checked_at ? ` · checked ${day(str(d.last_checked_at))}` : ""}` })) };
  }
  if (id === "plaid") {
    const banks = await many(ctx.sb.from("bank_accounts").select("name, official_name, mask, current_balance, balance_at").eq("organization_id", org));
    return { title: "Bank accounts", rows: banks.map((b) => ({ text: `${str(b.name) || str(b.official_name)}${b.mask ? ` ••${str(b.mask)}` : ""} · ${usd(num(b.current_balance))}${b.balance_at ? ` · ${day(str(b.balance_at))}` : ""}` })) };
  }
  if (id === "gohighlevel") {
    const s = await one(ctx.sb.from("ghl_sync_state").select("last_pulled_at, last_result").eq("organization_id", org));
    return { title: "Last sync", rows: s ? [{ text: `${day(str(s.last_pulled_at))} · ${str(s.last_result)}` }] : [] };
  }
  if (id === "stripe") {
    const h = await one(ctx.sb.from("payments_health").select("state, checked_at, detail").eq("organization_id", org));
    return { title: "Payments health", rows: h ? [{ text: `${words(str(h.state))} · checked ${day(str(h.checked_at))}${h.detail ? ` · ${str(h.detail)}` : ""}` }] : [] };
  }
  return null;
}

const integrationHandler: EntityHandler = {
  kind: "admin.integration",
  async load(ctx, id) {
    const provider = findProvider(id);
    if (provider) {
      const saved = (await listIntegrations(ctx.organizationId).catch(() => [])).find((s) => s.provider === id);
      const settings = saved?.settings ?? {};
      const fieldRows: EntityRow[] = provider.fields.map((f) => ({
        text: `${f.label}: ${f.secret ? (saved?.filled.includes(f.key) ? "saved" : "not saved") : str(settings[f.key]) || "not set"}`,
      }));
      const actions: EntityAction[] = provider.fields.map((f) => ({
        id: `set:${f.key}`,
        label: `${f.secret && saved?.filled.includes(f.key) ? "Replace" : "Set"} ${f.label.toLowerCase()}`,
        input: { type: "text", label: f.label, placeholder: f.placeholder ?? f.help, initial: f.secret ? "" : str(settings[f.key]), required: true },
      }));
      if (saved) {
        actions.unshift({ id: "test", label: "Test", tone: "primary" });
        actions.push({ id: "disconnect", label: "Disconnect", tone: "danger", confirm: `Disconnect ${provider.name}? Everything saved for it is forgotten.` });
      }
      return {
        title: provider.name,
        subtitle: `${provider.area} · ${provider.enables}`,
        status: STATUS_WORDS[saved?.status ?? "not_connected"],
        fields: fields([
          ["Connected", saved?.connected_at ? day(saved.connected_at) : ""],
          ["Last checked", saved?.last_checked_at ? day(saved.last_checked_at) : ""],
          ["Last error", saved?.last_error],
          ["Help", provider.docsUrl],
        ]),
        sections: [
          { title: "What is saved", rows: fieldRows },
          { title: "How to get these", rows: provider.howTo.map((h) => ({ text: h })) },
        ],
        actions,
        note: provider.oauthStartPath
          ? "Save the keys here, then press Connect on its card under Settings › Integrations to sign in."
          : "Secret values are kept on the server and never shown again; a blank leaves the saved one alone.",
      };
    }

    const c = (await listAppConnections(ctx.organizationId).catch(() => [])).find((x) => x.id === id);
    if (!c) return null;
    const extra = await connectionExtras(ctx, id);
    return {
      title: c.name,
      subtitle: `${c.area} · ${c.what}`,
      status: STATUS_WORDS[c.status],
      fields: fields([
        ["Kept in", c.where],
        ["State", c.detail],
      ]),
      sections: [
        { title: "Checks", rows: c.checks.map((k) => ({ text: `${k.name}: ${k.present ? "set" : k.optional ? "optional, not set" : "missing"}` })) },
        ...(extra ? [{ ...extra, empty: "None." }] : []),
        ...(c.status !== "configured" ? [{ title: "How to fix it", rows: c.fix.map((f) => ({ text: f })) }] : []),
      ],
      actions: [],
      note: "Wired in before the Integrations page: its keys live in the server's environment, so there is nothing to change here.",
    };
  },
  async act(_ctx, id, action, value) {
    if (!findProvider(id)) return { ok: false, error: "This one is set in the server's environment, not here." };
    if (action === "test") return result(await testIntegrationAction(id));
    if (action === "disconnect") return result(await disconnectIntegrationAction(id));
    if (action.startsWith("set:")) {
      const key = action.slice(4);
      if (!findProvider(id)?.fields.some((f) => f.key === key)) return UNKNOWN;
      if (!value?.trim()) return { ok: false, error: "Type a value." };
      return result(await saveIntegrationAction(id, { [key]: value }));
    }
    return UNKNOWN;
  },
};

/* ------------------------------------------------------------------ */
/* The business and its locations                                       */
/* ------------------------------------------------------------------ */

const ORG_COLS = "id, name, business_phone, business_email, business_address, business_website, logo_path, booking_notice_hours, reminder_time_zone, crew_cost_per_hour, created_at";
const ORG_FIELD: Record<string, { col: string; key: "phone" | "email" | "address" | "website"; label: string; type: "tel" | "email" | "textarea" | "text" }> = {
  set_phone: { col: "business_phone", key: "phone", label: "Phone", type: "tel" },
  set_email: { col: "business_email", key: "email", label: "Email", type: "email" },
  set_address: { col: "business_address", key: "address", label: "Address", type: "textarea" },
  set_website: { col: "business_website", key: "website", label: "Website", type: "text" },
};

const organizationHandler: EntityHandler = {
  kind: "admin.organization",
  async load(ctx, id) {
    if (id !== ctx.organizationId) return null;
    const o = await one(ctx.sb.from("organizations").select(ORG_COLS).eq("id", id));
    if (!o) return null;
    const [locations, people] = await Promise.all([
      many(ctx.sb.from("business_locations").select("id, name, address").eq("organization_id", id).order("name")),
      many(ctx.sb.from("profiles").select("id").eq("organization_id", id)),
    ]);
    return {
      title: str(o.name) || "The business",
      subtitle: `${people.length} people · since ${day(str(o.created_at))}`,
      fields: fields([
        ["Phone", o.business_phone],
        ["Email", o.business_email],
        ["Address", o.business_address],
        ["Website", o.business_website],
        ["Booking notice", o.booking_notice_hours == null ? "" : `${num(o.booking_notice_hours)} hours`],
        ["Time zone", o.reminder_time_zone],
        ["Crew cost per hour", o.crew_cost_per_hour == null ? "" : usdExact(num(o.crew_cost_per_hour))],
      ]),
      sections: [{ title: "Locations", rows: locations.map((l) => row(`${str(l.name)}${l.address ? ` · ${str(l.address)}` : ""}`, "admin.location", l.id)), empty: "None on file." }],
      actions: Object.entries(ORG_FIELD).map(([aid, f]) => ({ id: aid, label: `Change ${f.label.toLowerCase()}`, input: { type: f.type, label: f.label, initial: str(o[f.col]) } })),
      note: "What prints at the top of every receipt, proposal and invoice.",
    };
  },
  async act(ctx, id, action, value) {
    if (id !== ctx.organizationId) return { ok: false, error: "That isn't your business." };
    const f = ORG_FIELD[action];
    if (!f) return UNKNOWN;
    const o = await one(ctx.sb.from("organizations").select(ORG_COLS).eq("id", id));
    if (!o) return { ok: false, error: "Couldn't read the business." };
    const current = { phone: str(o.business_phone), email: str(o.business_email), address: str(o.business_address), website: str(o.business_website), logoPath: str(o.logo_path) };
    return result(await setBusinessDetails({ ...current, [f.key]: value ?? "" }), "Saved.");
  },
};

const locationHandler: EntityHandler = {
  kind: "admin.location",
  async load(ctx, id) {
    const l = await one(ctx.sb.from("business_locations").select("id, name, address, access_codes, created_at").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!l) return null;
    return {
      title: str(l.name) || "Location",
      subtitle: str(l.address) || undefined,
      fields: fields([
        ["Access codes", l.access_codes],
        ["Added", day(str(l.created_at))],
      ]),
      sections: [{ title: "Business", rows: [row("The business", "admin.organization", ctx.organizationId)] }],
      actions: [
        { id: "rename", label: "Rename", input: { type: "text", label: "Name", initial: str(l.name), required: true } },
        { id: "address", label: "Change address", input: { type: "textarea", label: "Address", initial: str(l.address) } },
        { id: "delete", label: "Delete", tone: "danger", confirm: "Delete this location? Tools and stock stored there lose their place." },
      ],
    };
  },
  async act(ctx, id, action, value) {
    const l = await one(ctx.sb.from("business_locations").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!l) return { ok: false, error: "Couldn't find that location." };
    switch (action) {
      case "rename":
        if (!value?.trim()) return { ok: false, error: "Give it a name." };
        return attempt(() => updateBusinessLocation(id, { name: value }), "Renamed.");
      case "address":
        return attempt(() => updateBusinessLocation(id, { address: value?.trim() || null }), "Address saved.");
      case "delete":
        return attempt(() => deleteBusinessLocation(id), "Deleted.");
    }
    return UNKNOWN;
  },
};

/* ------------------------------------------------------------------ */
/* Services                                                             */
/* ------------------------------------------------------------------ */

const SERVICE_COLS = "service_type_id, name, status, cost, cost_unit, estimated_hours, how_to, merged_into, updated_at";

const serviceHandler: EntityHandler = {
  kind: "admin.service",
  async load(ctx, id) {
    const s = await one(ctx.sb.from("services").select(SERVICE_COLS).eq("service_type_id", id).eq("organization_id", ctx.organizationId));
    if (!s) return null;
    const status = str(s.status);
    const actions: EntityAction[] = [];
    if (status === "active" || status === "pending") {
      actions.push({ id: "price", label: "Change price", tone: status === "active" ? "primary" : "default", input: { type: "number", label: `Price (${str(s.cost_unit) || "flat rate"})`, initial: s.cost == null ? "" : String(s.cost) } });
    }
    if (status === "pending") actions.unshift({ id: "accept", label: "Offer it at this price", tone: "primary", confirm: s.cost == null ? "It has no price yet. Offer it anyway?" : undefined });
    if (status === "active" || status === "pending") {
      actions.push({ id: "deny", label: status === "pending" ? "Turn it down" : "Stop offering it", tone: "danger", confirm: "Jobs asking for it will show “outside our scope” instead of a price. Go ahead?" });
    }
    return {
      title: str(s.name) || id,
      subtitle: id,
      status: words(status),
      fields: fields([
        ["Price", s.cost == null ? "No price" : `${usdExact(num(s.cost))} ${str(s.cost_unit)}`],
        ["Hours", s.estimated_hours],
        ["How it's done", s.how_to],
        ["Merged into", s.merged_into],
        ["Changed", day(str(s.updated_at))],
      ]),
      actions,
    };
  },
  async act(ctx, id, action, value) {
    const s = await one(ctx.sb.from("services").select(SERVICE_COLS).eq("service_type_id", id).eq("organization_id", ctx.organizationId));
    if (!s) return { ok: false, error: "Couldn't find that service." };
    const hours = s.estimated_hours == null ? null : num(s.estimated_hours);
    switch (action) {
      case "price": {
        const cost = value?.trim() ? Number(value) : null;
        if (cost != null && !(Number.isFinite(cost) && cost >= 0)) return { ok: false, error: "That isn't a price." };
        return result(await updateServicePricing(id, cost, str(s.cost_unit), hours), "Price saved.");
      }
      case "accept":
        return attempt(() => acceptServiceType(id, null, s.cost == null ? null : num(s.cost), str(s.cost_unit), hours), "Offered.");
      case "deny":
        return attempt(() => denyServiceType(id), "No longer offered.");
    }
    return UNKNOWN;
  },
};

/* ------------------------------------------------------------------ */
/* Compliance obligations                                               */
/* ------------------------------------------------------------------ */

const OBLIGATION_COLS =
  "id, kind, title, holder, due_on, recurrence, date_confirmed, active, credits_required, credits_earned, carrier, policy_number, coverage_limits, document_path, notes, source_url, last_done_on, profile_id, fleet_asset_id";

function asInput(o: Row): ObligationInput {
  return {
    id: str(o.id),
    kind: str(o.kind),
    title: str(o.title),
    holder: str(o.holder) || null,
    dueOn: str(o.due_on) || null,
    recurrence: (str(o.recurrence) || "annual") as Recurrence,
    active: Boolean(o.active),
    dateConfirmed: Boolean(o.date_confirmed),
    creditsRequired: o.credits_required == null ? null : num(o.credits_required),
    creditsEarned: o.credits_earned == null ? null : num(o.credits_earned),
    carrier: str(o.carrier) || null,
    policyNumber: str(o.policy_number) || null,
    coverageLimits: str(o.coverage_limits) || null,
    notes: str(o.notes) || null,
  };
}

const obligationHandler: EntityHandler = {
  kind: "admin.obligation",
  async load(ctx, id) {
    const o = await one(ctx.admin.from("compliance_obligations").select(OBLIGATION_COLS).eq("id", id).eq("organization_id", ctx.organizationId));
    if (!o) return null;
    const [person, vehicle] = await Promise.all([
      o.profile_id ? one(ctx.sb.from("profiles").select("id, full_name, first_name, last_name, email").eq("id", str(o.profile_id))) : Promise.resolve(null),
      o.fleet_asset_id ? one(ctx.sb.from("fleet_assets").select("id, name").eq("id", str(o.fleet_asset_id))) : Promise.resolve(null),
    ]);
    const short = creditsShort({ creditsRequired: o.credits_required == null ? null : num(o.credits_required), creditsEarned: o.credits_earned == null ? null : num(o.credits_earned) });
    const related: EntityRow[] = [
      ...(person ? [row(personName(person), "admin.profile", person.id)] : []),
      ...(vehicle ? [row(str(vehicle.name) || "Vehicle", "admin.fleet_asset", vehicle.id)] : []),
    ];
    const actions: EntityAction[] = [];
    if (o.active && o.due_on) actions.push({ id: "done", label: "Mark done", tone: "primary", confirm: "Renewed, filed or paid? The date rolls to the next one." });
    actions.push({ id: "date", label: o.due_on ? "Change the date" : "Set the date", input: { type: "date", label: "Due", initial: str(o.due_on), required: true } });
    if (o.active && o.due_on && !o.date_confirmed) actions.push({ id: "confirm", label: "The date is right" });
    if (o.document_path) actions.push({ id: "doc", label: "Get a link to the document" });
    actions.push(o.active ? { id: "inactive", label: "We don't hold this", tone: "danger", confirm: "Take this off the calendar? Reminders stop." } : { id: "active", label: "We hold this" });
    return {
      title: str(o.title),
      subtitle: KIND_LABEL[str(o.kind) as ObligationKind] ?? words(str(o.kind)),
      status: !o.active ? "Not held" : o.due_on ? `Due ${day(str(o.due_on))}${o.date_confirmed ? "" : " (not confirmed)"}` : "No date yet",
      fields: fields([
        ["Holder", o.holder],
        ["Repeats", words(str(o.recurrence))],
        ["Last done", o.last_done_on ? day(str(o.last_done_on)) : ""],
        ["Credits", short == null ? "" : short === 0 ? "Done" : `${short} to go`],
        ["Carrier", o.carrier],
        ["Policy", o.policy_number],
        ["Limits", o.coverage_limits],
        ["Document", o.document_path ? "On file" : "Not uploaded"],
        ["Notes", o.notes],
        ["Source", o.source_url],
      ]),
      sections: related.length ? [{ title: "For", rows: related }] : undefined,
      actions,
      note: o.document_path ? undefined : "Documents are uploaded from Settings › Compliance.",
    };
  },
  async act(ctx, id, action, value) {
    const o = await one(ctx.admin.from("compliance_obligations").select(OBLIGATION_COLS).eq("id", id).eq("organization_id", ctx.organizationId));
    if (!o) return { ok: false, error: "Couldn't find that." };
    switch (action) {
      case "done":
        return result(await markObligationDone(id));
      case "confirm":
        return result(await confirmObligationDate(id), "Confirmed. Reminders are on for it.");
      case "date":
        if (!isIsoDate(value)) return { ok: false, error: "Pick a date." };
        return result(await saveObligation({ ...asInput(o), dueOn: value, dateConfirmed: true }), `Due ${day(value)}.`);
      case "active":
      case "inactive":
        return result(await saveObligation({ ...asInput(o), active: action === "active" }), action === "active" ? "Back on the calendar." : "Taken off the calendar.");
      case "doc": {
        const r = await openDoc({ area: "obligation", id });
        return r.ok ? { ok: true, message: `Good for 10 minutes: ${r.url}` } : { ok: false, error: r.error };
      }
    }
    return UNKNOWN;
  },
};

export const ADMIN_SETTINGS_HANDLERS: EntityHandler[] = [integrationHandler, organizationHandler, locationHandler, serviceHandler, obligationHandler];
