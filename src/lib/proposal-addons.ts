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
 * Pure, so it is tested without a database.
 */

export type AddonLights = "ours" | "theirs";
export type AddonTakedown = "included" | "not_included";

export interface ProposalAddon {
  key: string;
  /** What the client sees, e.g. "Christmas lights". */
  name: string;
  priceCents: number;
  /** What we will decorate: "Front of the house, the two bushes by the door". */
  decorate: string;
  /** Whose lights go up. Null when it is not said. */
  lights: AddonLights | null;
  /** Whether taking them down after the season is in the price. Null when it is not said. */
  takedown: AddonTakedown | null;
  /** Anything else the client should know. */
  note: string;
  /** Set when the client accepted with it ticked. */
  chosen?: boolean;
}

export const CHRISTMAS_LIGHTS_KEY = "christmas-lights";
export const CHRISTMAS_LIGHTS_NAME = "Christmas lights";

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
    const price = Number(r.priceCents);
    if (!key || !name || seen.has(key) || !Number.isFinite(price) || price <= 0) continue;
    seen.add(key);
    out.push({
      key,
      name,
      priceCents: Math.round(price),
      decorate: text(r.decorate),
      lights: r.lights === "ours" || r.lights === "theirs" ? r.lights : null,
      takedown: r.takedown === "included" || r.takedown === "not_included" ? r.takedown : null,
      note: text(r.note),
      ...(r.chosen === true ? { chosen: true } : {}),
    });
  }
  return out;
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
  if (addon.lights === "ours") lines.push("We supply the lights");
  if (addon.lights === "theirs") lines.push("We hang your lights");
  if (addon.takedown === "included") lines.push("Takedown after the holidays is included");
  if (addon.takedown === "not_included") lines.push("Takedown after the holidays is not included");
  if (addon.note) lines.push(addon.note);
  return lines;
}

/** The add-ons the client ticked, by key, keeping only ones on the proposal. */
export function pickAddons(addons: ProposalAddon[], keys: readonly string[] | null | undefined): ProposalAddon[] {
  const want = new Set(keys ?? []);
  return addons.filter((a) => want.has(a.key));
}

export function addonsCents(addons: ProposalAddon[]): number {
  return addons.reduce((sum, a) => sum + a.priceCents, 0);
}

/** The add-ons as they stand once accepted: the ticked ones marked chosen, the rest not. */
export function markChosen(addons: ProposalAddon[], keys: readonly string[] | null | undefined): ProposalAddon[] {
  const want = new Set(keys ?? []);
  return addons.map((a) => {
    const out = { ...a };
    if (want.has(a.key)) out.chosen = true;
    else delete out.chosen;
    return out;
  });
}

/**
 * The account manager's form, checked and turned into an add-on.
 * Returns a sentence to show them when something is missing.
 */
export function addonFromForm(input: {
  key: string;
  name: string;
  price: string | number;
  decorate: string;
  lights: string;
  takedown: string;
  note: string;
}): ProposalAddon | string {
  const name = text(input.name) || CHRISTMAS_LIGHTS_NAME;
  const dollars = typeof input.price === "number" ? input.price : Number(String(input.price).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(dollars) || dollars <= 0) return "Put a price on it first.";
  if (dollars > 100000) return "That price looks too high. Check it and try again.";
  return {
    key: text(input.key) || CHRISTMAS_LIGHTS_KEY,
    name: name.slice(0, 60),
    priceCents: Math.round(dollars * 100),
    decorate: text(input.decorate).slice(0, 300),
    lights: input.lights === "ours" || input.lights === "theirs" ? input.lights : null,
    takedown: input.takedown === "included" || input.takedown === "not_included" ? input.takedown : null,
    note: text(input.note).slice(0, 300),
  };
}
