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

/**
 * One zone, and which service it is, for working out scopes together.
 *
 * The service id is what makes zones the same job. Two lawn care areas on one
 * property are the same work done twice, not two different pieces of work.
 */
export interface ZoneScopeInput extends ScopeInput {
  /** The service this zone is. Zones that share it share their scope. */
  serviceId?: string | null;
}

/**
 * The scope for every zone, answered one service at a time.
 *
 * The crew does the same thing in every lawn area, and the same thing in every
 * bed, so a proposal that describes each area differently is describing a job
 * nobody is going to do. Worse, the differences were accidental: the wording
 * is generated from the evaluator's answers, and two areas answered slightly
 * differently produced two paragraphs that read as two different services.
 *
 * So the paragraph belongs to the service, and every area of that service gets
 * it. The one exception is the thing that was actually said about one area: a
 * note typed on a zone during the evaluation is about that area -- the bed with
 * the fence to work around, the strip the dog is in -- and it stays there.
 *
 * Where a business has written its own wording for a service, that is the
 * shared scope. Where it has not, the shared scope is whichever generated
 * paragraph most of that service's areas produced, so one area answered oddly
 * does not rewrite the other five.
 */
export function scopesForZones(zones: readonly ZoneScopeInput[]): string[] {
  const shared = new Map<string, string>();

  for (const [key, group] of byService(zones)) {
    const preset = group.map((zone) => zone.pricing?.scopeTemplate?.trim()).find(Boolean);
    if (preset) {
      shared.set(key, preset);
      continue;
    }
    const generated = group
      .map((zone) => zone.def?.autoScope?.((zone.values ?? {}) as never)?.trim())
      .filter((text): text is string => Boolean(text));
    shared.set(key, commonest(generated));
  }

  return zones.map((zone, index) => {
    // What somebody wrote standing in front of this area beats anything a
    // preset or a template can say about the service in general.
    const notes = zone.notes?.trim();
    if (notes) return notes;
    return shared.get(serviceKey(zone, index)) ?? "";
  });
}

/**
 * Which other zones are the same service as this one.
 *
 * The office edits scope one area at a time; this is what lets it say "and the
 * other three areas of this too" without anybody counting.
 */
export function zonesSharingService(
  zones: readonly { serviceId?: string | null }[],
  index: number
): number[] {
  const id = zones[index]?.serviceId?.trim();
  if (!id) return [];
  return zones.reduce<number[]>((out, zone, i) => {
    if (i !== index && zone.serviceId?.trim() === id) out.push(i);
    return out;
  }, []);
}

/** A zone with no service is its own group: there is nothing to share with. */
function serviceKey(zone: ZoneScopeInput, index: number): string {
  const id = zone.serviceId?.trim();
  return id ? `service:${id}` : `zone:${index}`;
}

function byService(zones: readonly ZoneScopeInput[]): Map<string, ZoneScopeInput[]> {
  const groups = new Map<string, ZoneScopeInput[]>();
  zones.forEach((zone, index) => {
    const key = serviceKey(zone, index);
    const list = groups.get(key) ?? [];
    list.push(zone);
    groups.set(key, list);
  });
  return groups;
}

/**
 * The text that came up most often, and the earliest one when it is a tie.
 *
 * A count rather than a merge: the wording is a whole sentence about how the
 * work is done, and half of one sentence joined to half of another is not a
 * scope of work. What most of the areas said is the closest thing to what the
 * crew is going to do.
 */
function commonest(texts: readonly string[]): string {
  let best = "";
  let bestCount = 0;
  const counts = new Map<string, number>();
  for (const text of texts) {
    const count = (counts.get(text) ?? 0) + 1;
    counts.set(text, count);
    if (count > bestCount) {
      best = text;
      bestCount = count;
    }
  }
  return best;
}
