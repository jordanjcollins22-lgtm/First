/**
 * What a zone's service is called, and what the client is told it covers.
 *
 * Both of these used to come only from the built-in service catalogue in
 * `service-catalog.ts`, which is a fixed list compiled into the app. A
 * business that adds its own service gets an id like
 * `custom-488c16d9-2617-46ea-8635-cb7ce7bd8448`, which is in no such list —
 * so the lookup returned nothing, the label fell through to the raw id, and
 * a client's proposal read "custom-488c16d9-..." under every zone with no
 * scope text at all.
 *
 * The name was never missing. It was sitting on the pricing row the whole
 * time, which is where a custom service is actually defined.
 */

/** As much of a built-in service definition as naming a zone needs. */
export interface ServiceDefLike {
  label: string;
  // Takes the values the evaluator entered. Typed loosely on purpose: the
  // built-in definitions declare Record<string, string>, and a narrower
  // parameter here would make every one of them fail to fit.
  autoScope?: (values: never) => string;
}

/** As much of a pricing row as naming a zone needs. */
export interface PricingRowLike {
  name: string;
  /** The wording that goes on a client's proposal for this service. */
  scopeTemplate?: string | null;
}

/**
 * What to call this service on screen and on the proposal.
 *
 * Never the id. An id in front of a client is worse than the word "Service",
 * because "Service" reads as a gap and a uuid reads as a broken app.
 */
export function serviceLabelFor(
  def: ServiceDefLike | undefined,
  pricing: PricingRowLike | undefined
): string {
  const fromDef = def?.label?.trim();
  if (fromDef) return fromDef;
  const fromPricing = pricing?.name?.trim();
  if (fromPricing) return fromPricing;
  return "Service";
}

export interface ScopeInput {
  def?: ServiceDefLike;
  pricing?: PricingRowLike;
  /** The answers the evaluator gave on this zone. */
  values?: Record<string, unknown>;
  /** Anything typed on the zone itself. */
  notes?: string | null;
}

/**
 * The paragraph that describes this zone's work on the proposal.
 *
 * Order matters and is deliberate. What somebody typed about this particular
 * zone wins over any preset, because it was written while standing in the
 * garden. Then the business's own preset for the service, then whatever the
 * built-in definition generates from the evaluator's answers.
 *
 * A custom service used to reach none of these and produce an empty string,
 * which is how eight zones ended up with a heading and nothing under it.
 */
export function scopeTextFor(input: ScopeInput): string {
  const notes = input.notes?.trim();
  if (notes) return notes;

  const preset = input.pricing?.scopeTemplate?.trim();
  if (preset) return preset;

  const generated = input.def?.autoScope?.((input.values ?? {}) as never)?.trim();
  if (generated) return generated;

  return "";
}

/**
 * Whether a zone would go out with nothing to read under its heading.
 *
 * Worth knowing before a proposal is sent rather than after: a scope of work
 * with eight empty sections is not a scope of work.
 */
export function zoneNeedsScope(input: ScopeInput): boolean {
  return scopeTextFor(input).length === 0;
}

/** True when this id is one the app generated rather than a real name. */
export function looksLikeRawId(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("custom-") ||
    // A bare uuid, in case one reaches a label field by another route.
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
  );
}

/**
 * Repair a label that already went out as an id.
 *
 * Proposals are snapshots, so the ones generated while this was broken still
 * hold the uuid in `serviceLabel`. Rebuilding fixes them, but until somebody
 * does, this keeps a uuid off the client's screen.
 */
export function displayLabel(stored: string, pricing: PricingRowLike | undefined): string {
  if (!looksLikeRawId(stored)) return stored;
  const fromPricing = pricing?.name?.trim();
  return fromPricing || "Service";
}
