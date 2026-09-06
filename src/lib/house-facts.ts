import { RELATIONSHIP_STAGES, STAGE_COLOR, STAGE_LABEL, type RelationshipStage } from "@/lib/house-relationship";

/**
 * One house, everything known, as the map's card shows it.
 *
 * The database answers with every table's part in one object; this turns
 * it into the card's HTML. Pure and escaped: names, notes and addresses
 * are people's text, and a popup is HTML.
 */

export interface HouseFacts {
  id: string;
  address: string;
  lat: number;
  lng: number;
  countyPin: boolean;
  stageRank: number;
  events: { kind: string; at: string; amountCents: number | null; note: string | null }[];
  contacts: { id: string; name: string | null; phone: string | null; role: string | null; doNotContact: boolean | null }[];
  ownership: {
    ownerOccupied: boolean | null;
    reason: string | null;
    ownerName: string | null;
    lastSaleDate: string | null;
    lastSalePrice: number | null;
    yearBuilt: number | null;
    landUse: string | null;
    assessedValue: number | null;
    accountId: string | null;
    fetchedAt: string | null;
  } | null;
  route: {
    zip: string;
    routeId: string;
    walkability: string;
    reason: string | null;
    distanceM: number | null;
    houseCount: number;
    waveId: string | null;
    waveName: string | null;
    waveStatus: string | null;
    zoneId: string | null;
    zoneName: string | null;
  } | null;
  unserved: boolean;
  hangers: { count: number; last: string | null; designs: number[] };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const EVENT_LABEL: Record<string, string> = {
  spoken_to: "Spoke to them",
  evaluation: "Evaluated",
  proposal: "Quoted",
  client: "Became a client",
  job_completed: "Work completed",
};

function money(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function dollars(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `$${Math.round(value).toLocaleString()}`;
}

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The State's own page for the parcel, from its account id: county code, district, account. */
export function sdatLink(accountId: string | null | undefined): string | null {
  if (!accountId) return null;
  const digits = accountId.replace(/\D/g, "");
  if (digits.length < 6) return null;
  const county = digits.slice(0, 2);
  const district = digits.slice(2, 4);
  const account = digits.slice(4);
  return `https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=${county}&SearchType=ACCT&District=${district}&AccountNumber=${account}`;
}

/** One line: who lives there, as far as the roll and our own records say. */
export function occupancyLine(facts: Pick<HouseFacts, "ownership" | "contacts" | "stageRank">): { text: string; tone: "good" | "warn" | "muted" } {
  const o = facts.ownership;
  if (!o) return { text: "Not on the State's roll", tone: "muted" };
  if (o.ownerOccupied === true) return { text: "Owner lives here", tone: "good" };
  if (o.ownerOccupied === false) {
    const talked = facts.stageRank >= 1;
    return { text: talked ? "Rented: the people we know here are tenants, not the owner" : "Rented or held: the owner lives elsewhere", tone: "warn" };
  }
  return { text: "Ownership unknown", tone: "muted" };
}

/** The card. Sections only where there is something to say. */
export function renderHouseCard(facts: HouseFacts): string {
  const stage: RelationshipStage = RELATIONSHIP_STAGES[facts.stageRank] ?? "untouched";
  const rows: string[] = [];

  // Where we stand, and with whom.
  const people = facts.contacts
    .map((c) => {
      const name = escapeHtml(c.name ?? "Unnamed");
      const link = `<a href="/clients/${escapeHtml(c.id)}" style="color:#2f6d3c;text-decoration:underline">${name}</a>`;
      const bits = [c.role ? escapeHtml(c.role) : null, c.phone ? escapeHtml(c.phone) : null, c.doNotContact ? `<span style="color:#b91c1c">do not contact</span>` : null].filter(Boolean);
      return `${link}${bits.length ? ` <span style="color:#666">(${bits.join(", ")})</span>` : ""}`;
    })
    .join("<br>");
  const lastEvent = facts.events[0];
  rows.push(
    section(
      "Where we stand",
      `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${STAGE_COLOR[stage]};margin-right:5px"></span><b>${escapeHtml(STAGE_LABEL[stage])}</b>` +
        (lastEvent ? ` <span style="color:#666">· ${escapeHtml(EVENT_LABEL[lastEvent.kind] ?? lastEvent.kind)} ${escapeHtml(day(lastEvent.at) ?? "")}${lastEvent.amountCents ? `, ${money(lastEvent.amountCents)}` : ""}</span>` : "") +
        (people ? `<div style="margin-top:2px">${people}</div>` : `<div style="color:#666">Nobody on record here</div>`)
    )
  );

  // Who owns it.
  const occ = occupancyLine(facts);
  const o = facts.ownership;
  const ownerBits = o
    ? [
        o.lastSaleDate ? `Sold ${escapeHtml(day(o.lastSaleDate) ?? o.lastSaleDate)}${o.lastSalePrice ? ` for ${dollars(o.lastSalePrice)}` : ""}` : "No sale on record",
        o.yearBuilt ? `built ${o.yearBuilt}` : null,
        o.assessedValue ? `assessed ${dollars(o.assessedValue)}` : null,
        o.landUse ? escapeHtml(o.landUse) : null,
      ].filter(Boolean)
    : [];
  const soldRecently = o?.lastSaleDate && Date.now() - new Date(o.lastSaleDate).getTime() < 365 * 86_400_000;
  const link = sdatLink(o?.accountId);
  rows.push(
    section(
      "Who owns it",
      `<b style="color:${occ.tone === "good" ? "#15803d" : occ.tone === "warn" ? "#c2410c" : "#666"}">${escapeHtml(occ.text)}</b>` +
        (soldRecently ? ` <span style="color:#e11d48;font-weight:600">· new owners</span>` : "") +
        (o?.ownerName ? `<div>${escapeHtml(o.ownerName)}</div>` : "") +
        (ownerBits.length ? `<div style="color:#666">${ownerBits.join(" · ")}</div>` : "") +
        (link ? `<a href="${link}" target="_blank" rel="noopener" style="color:#2f6d3c;text-decoration:underline">State record</a>` : "")
    )
  );

  // Door hangers: the route, the wave, what has been hung.
  const r = facts.route;
  const hung = facts.hangers.count > 0 ? `${facts.hangers.count} hanger${facts.hangers.count === 1 ? "" : "s"} so far, last ${escapeHtml(day(facts.hangers.last) ?? "")}${facts.hangers.designs.length ? ` (design ${facts.hangers.designs.join(", ")})` : ""}` : "No hangers yet";
  const routeLine = r
    ? `USPS route ${escapeHtml(r.zip)} ${escapeHtml(r.routeId)}: ` +
      (r.walkability === "walkable"
        ? `<span style="color:#15803d">walkable</span>${r.waveName ? `, wave <b>${escapeHtml(r.waveName)}</b>${r.waveStatus ? ` (${escapeHtml(r.waveStatus)})` : ""}` : ""}`
        : r.walkability === "hard"
          ? `<span style="color:#c2410c">hard to walk</span>${r.reason ? ` <span style="color:#666">· ${escapeHtml(r.reason)}</span>` : ""}`
          : "not judged yet") +
      (r.distanceM != null ? ` <span style="color:#666">· ${r.distanceM} m from the street</span>` : "")
    : facts.unserved
      ? `<span style="color:#a21caf">No USPS route reaches this house</span> · take it in on the nearest walk`
      : "No route assigned yet";
  rows.push(section("Door hangers", `${routeLine}<div style="color:#666">${hung}</div>`));

  return (
    `<div style="font:400 12.5px/1.35 system-ui;max-width:300px">` +
    `<div style="font-weight:600;font-size:13px;margin-bottom:4px">${escapeHtml(facts.address)}</div>` +
    rows.join("") +
    `</div>`
  );
}

function section(title: string, body: string): string {
  return `<div style="border-top:1px solid #e5e7eb;padding:5px 0 2px"><div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#888">${title}</div><div>${body}</div></div>`;
}

/** The card while its facts are on their way. */
export function renderHouseCardLoading(label: string): string {
  return `<div style="font:400 12.5px system-ui;color:#666"><div style="font-weight:600;color:#111">${escapeHtml(label)}</div>Gathering everything we know…</div>`;
}
