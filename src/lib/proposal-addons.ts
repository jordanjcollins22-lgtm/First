/**
 * Add-ons on a proposal: something extra the client can tick on when they
 * accept, like Christmas lights, priced by the account manager for that one
 * proposal. Unticked, the proposal is exactly what it was.
 *
 * Kept in the proposal's `options` json under `addons`, so no new column is
 * needed and every reader of options keeps working: readOptions ignores the
 * key, and a proposal with add-ons but no packages still reads as one price.
 *
 * What is decorated, whose lights they are and whether takedown is included
 * are all set per proposal, because none of it is a fixed rule yet.
 *
 * An add-on can be split into areas (roofline, front trees, bushes...), each
 * with its own price. The client then ticks the areas they want rather than
 * the whole thing, and only those are added to the total. The account
 * manager prices the areas once and those standard prices carry over: each
 * new proposal starts from the areas and prices last saved on any proposal
 * (see standardAreas), or from DEFAULT_LIGHT_AREAS unpriced the first time.
 * They can still change a price, rename, add or drop an area per proposal.
 *
 * Pure, so it is tested without a database.
 */

export type AddonLights = "ours" | "theirs";
export type AddonTakedown = "included" | "not_included";

/** One part of an add-on the client can pick on its own, e.g. the roofline. */
export interface AddonArea {
  key: string;
  /** What the client sees, e.g. "Roofline". */
  name: string;
  priceCents: number;
  /** Set when the client accepted with this area ticked. */
  chosen?: boolean;
}

export interface ProposalAddon {
  key: string;
  /** What the client sees, e.g. "Christmas lights". */
  name: string;
  /** With areas, the price of every area together. */
  priceCents: number;
  /**
   * The areas the client picks from, each priced on its own. Absent on an
   * add-on that is one tick for one price.
   */
  areas?: AddonArea[];
  /** What we will decorate: "Front of the house, the two bushes by the door". */
  decorate: string;
  /** Whose lights go up. Null when it is not said. */
  lights: AddonLights | null;
  /** Whether taking them down after the season is in the price. Null when it is not said. */
  takedown: AddonTakedown | null;
  /** Anything else the client should know. */
  note: string;
  /** When the account manager last saved it; the newest one sets the standard prices. */
  savedAt?: string;
  /** Set when the client accepted with it ticked. */
  chosen?: boolean;
}

export const CHRISTMAS_LIGHTS_KEY = "christmas-lights";
export const CHRISTMAS_LIGHTS_NAME = "Christmas lights";

/** Where the account manager starts; they rename, add or drop areas per proposal. */
export const DEFAULT_LIGHT_AREAS = ["Roofline / gutters", "Front trees", "Bushes / shrubs", "Walkway / driveway", "Front door / porch"] as const;

/** The key the client's choice of one area travels under: "<add-on key>/<area key>". */
export function areaPick(addonKey: string, areaKey: string): string {
  return `${addonKey}/${areaKey}`;
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "area";

function readAreas(raw: unknown): AddonArea[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AddonArea[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const key = text(r.key);
    const name = text(r.name);
    const price = Number(r.priceCents);
    if (!key || !name || seen.has(key) || key.includes("/") || !Number.isFinite(price) || price <= 0) continue;
    seen.add(key);
    out.push({ key, name, priceCents: Math.round(price), ...(r.chosen === true ? { chosen: true } : {}) });
  }
  return out.length ? out : null;
}

const sumAreas = (areas: AddonArea[]) => areas.reduce((sum, a) => sum + a.priceCents, 0);

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The add-ons on a proposal. Anything malformed is dropped, never a reason to break the page. */
export function readAddons(rawOptions: unknown): ProposalAddon[] {
  if (!rawOptions || typeof rawOptions !== "object") return [];
  const list = (rawOptions as { addons?: unknown }).addons;
  if (!Array.isArray(list)) return [];
  const out: ProposalAddon[] = [];
  const seen = new Set<string>();
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const key = text(r.key);
    const name = text(r.name);
    const areas = readAreas(r.areas);
    const price = areas ? sumAreas(areas) : Number(r.priceCents);
    if (!key || !name || seen.has(key) || !Number.isFinite(price) || price <= 0) continue;
    seen.add(key);
    out.push({
      key,
      name,
      priceCents: Math.round(price),
      ...(areas ? { areas } : {}),
      decorate: text(r.decorate),
      lights: r.lights === "ours" || r.lights === "theirs" ? r.lights : null,
      takedown: r.takedown === "included" || r.takedown === "not_included" ? r.takedown : null,
      note: text(r.note),
      ...(text(r.savedAt) ? { savedAt: text(r.savedAt) } : {}),
      ...(r.chosen === true ? { chosen: true } : {}),
    });
  }
  return out;
}

/**
 * The standard areas and prices: the Christmas lights areas most recently
 * saved on any of these proposals' options, without anyone's ticks. Null
 * when none has been priced by area yet. Ties and undated ones go to the
 * earlier entry, so pass the newest proposal first.
 */
export function standardAreas(optionsList: readonly unknown[]): AddonArea[] | null {
  let best: { at: string; areas: AddonArea[] } | null = null;
  for (const options of optionsList) {
    const lights = readAddons(options).find((a) => a.key === CHRISTMAS_LIGHTS_KEY && a.areas);
    if (!lights?.areas) continue;
    const at = lights.savedAt ?? "";
    if (!best || at > best.at) best = { at, areas: lights.areas.map(({ key, name, priceCents }) => ({ key, name, priceCents })) };
  }
  return best?.areas ?? null;
}

/** The options json with these add-ons in place of the old ones. Packages and pictures are left alone. */
export function withAddons(rawOptions: unknown, addons: ProposalAddon[]): Record<string, unknown> {
  const base = rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions) ? { ...(rawOptions as Record<string, unknown>) } : {};
  if (addons.length) base.addons = addons;
  else delete base.addons;
  return base;
}

/** One add-on put in, replaced, or (with null) taken off by key. */
export function setAddon(addons: ProposalAddon[], key: string, next: ProposalAddon | null): ProposalAddon[] {
  const rest = addons.filter((a) => a.key !== key);
  return next ? [...rest, next] : rest;
}

/** What the client reads under the add-on's name. Only what was actually set. */
export function addonLines(addon: ProposalAddon): string[] {
  const lines: string[] = [];
  if (addon.decorate) lines.push(`We decorate: ${addon.decorate}`);
  const picked = addon.areas?.filter((a) => a.chosen) ?? [];
  if (picked.length) lines.push(`Areas: ${picked.map((a) => a.name).join(", ")}`);
  if (addon.lights === "ours") lines.push("We supply the lights");
  if (addon.lights === "theirs") lines.push("We hang your lights");
  if (addon.takedown === "included") lines.push("Takedown after the holidays is included");
  if (addon.takedown === "not_included") lines.push("Takedown after the holidays is not included");
  if (addon.note) lines.push(addon.note);
  return lines;
}

/**
 * The add-ons the client ticked, keeping only ones on the proposal. An
 * add-on with areas comes back with just the areas they ticked, priced at
 * those areas together; with none ticked it is left out.
 */
export function pickAddons(addons: ProposalAddon[], keys: readonly string[] | null | undefined): ProposalAddon[] {
  const want = new Set(keys ?? []);
  const out: ProposalAddon[] = [];
  for (const a of addons) {
    if (a.areas) {
      const areas = a.areas.filter((x) => want.has(areaPick(a.key, x.key)));
      if (areas.length) out.push({ ...a, areas, priceCents: sumAreas(areas) });
    } else if (want.has(a.key)) {
      out.push(a);
    }
  }
  return out;
}

/** What the client is paying for this add-on once accepted: the chosen areas, or the whole price. */
export function chosenCents(addon: ProposalAddon): number {
  if (!addon.areas) return addon.chosen ? addon.priceCents : 0;
  return sumAreas(addon.areas.filter((a) => a.chosen));
}

export function addonsCents(addons: ProposalAddon[]): number {
  return addons.reduce((sum, a) => sum + a.priceCents, 0);
}

/**
 * The add-ons as they stand once accepted: the ticked ones marked chosen,
 * the rest not. With areas, each ticked area is marked and the add-on is
 * chosen when any of its areas is. Takes the same keys as pickAddons.
 */
export function markChosen(addons: ProposalAddon[], keys: readonly string[] | null | undefined): ProposalAddon[] {
  const want = new Set(keys ?? []);
  return addons.map((a) => {
    const out = { ...a };
    let on = want.has(a.key);
    if (a.areas) {
      out.areas = a.areas.map((x) => {
        const area = { ...x };
        if (want.has(areaPick(a.key, x.key))) area.chosen = true;
        else delete area.chosen;
        return area;
      });
      on = out.areas.some((x) => x.chosen);
    }
    if (on) out.chosen = true;
    else delete out.chosen;
    return out;
  });
}

const toDollars = (v: string | number) => (typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, "")));

/**
 * The account manager's form, checked and turned into an add-on.
 * Returns a sentence to show them when something is missing.
 */
export function addonFromForm(input: {
  key: string;
  name: string;
  price: string | number;
  /**
   * Areas the client picks from, each with its own price. Rows left empty are
   * dropped, and so is a row with a name but no price: that area is simply
   * not offered on this proposal. When given, `price` is ignored.
   */
  areas?: { name: string; price: string | number }[];
  decorate: string;
  lights: string;
  takedown: string;
  note: string;
}): ProposalAddon | string {
  const name = text(input.name) || CHRISTMAS_LIGHTS_NAME;
  let areas: AddonArea[] | undefined;
  let priceCents: number;
  if (input.areas) {
    areas = [];
    const used = new Set<string>();
    for (const row of input.areas) {
      const areaName = text(row.name).slice(0, 60);
      const blank = typeof row.price === "string" && !row.price.trim();
      if (!areaName || blank) continue;
      const d = toDollars(row.price);
      if (!Number.isFinite(d) || d <= 0) return `Check the price for ${areaName}.`;
      if (d > 100000) return `The price for ${areaName} looks too high. Check it and try again.`;
      let key = slug(areaName);
      for (let n = 2; used.has(key); n++) key = `${slug(areaName)}-${n}`;
      used.add(key);
      areas.push({ key, name: areaName, priceCents: Math.round(d * 100) });
    }
    if (!areas.length) return "Put a price on at least one area first.";
    priceCents = sumAreas(areas);
  } else {
    const dollars = toDollars(input.price);
    if (!Number.isFinite(dollars) || dollars <= 0) return "Put a price on it first.";
    if (dollars > 100000) return "That price looks too high. Check it and try again.";
    priceCents = Math.round(dollars * 100);
  }
  return {
    key: text(input.key) || CHRISTMAS_LIGHTS_KEY,
    name: name.slice(0, 60),
    priceCents,
    ...(areas ? { areas } : {}),
    decorate: text(input.decorate).slice(0, 300),
    lights: input.lights === "ours" || input.lights === "theirs" ? input.lights : null,
    takedown: input.takedown === "included" || input.takedown === "not_included" ? input.takedown : null,
    note: text(input.note).slice(0, 300),
  };
}
