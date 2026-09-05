/**
 * Changing an evaluation without going back out to the property.
 *
 * The evaluation is captured on the site map: areas drawn on a satellite
 * photo, each measured and given a service. That is right for the walk
 * itself and wrong for everything that happens afterwards. A client texts
 * "the back bed is more like thirty foot" or "can you do the side hedge
 * too", and the only way to act on it was to reopen the map on a phone and
 * redraw — which is fiddly, and worse, it is drawing when what actually
 * changed is a number.
 *
 * So the numbers, the wording and the areas themselves can be edited from a
 * list. An area added this way has no shape on the map, deliberately: a
 * rectangle invented in the office is a lie about where the work is, and a
 * measurement typed in from a phone call is not.
 */

import { readMeasurement, type MeasurementKind } from "@/lib/zone-measurement";

/** The parts of a zone this panel can change. Deliberately not the shape. */
export interface ZoneEdit {
  id: string;
  name: string;
  /** Strings, because that is what a form holds. */
  length: string;
  width: string;
  /** The evaluator saying a length with no width is a run, not a half-filled form. */
  linear: boolean;
  notes: string;
}

/** What a zone looks like coming out of the design. */
export interface EditableZone {
  id: string;
  name: string;
  lengthFt?: number | null;
  widthFt?: number | null;
  measurementKind?: MeasurementKind | null;
  areaSqFt: number | null;
  perimeterFt: number | null;
  service: { notes: string } | null;
  [key: string]: unknown;
}

function text(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

/** The form's starting state for one zone. */
export function editFor(zone: EditableZone): ZoneEdit {
  return {
    id: zone.id,
    name: zone.name,
    length: text(zone.lengthFt),
    width: text(zone.widthFt),
    linear: zone.measurementKind === "linear",
    notes: zone.service?.notes ?? "",
  };
}

/**
 * The zone after an edit.
 *
 * Area and perimeter are re-derived rather than carried over: a width that
 * changed with a stale area behind it is a zone that prices one way and
 * reads another, which is the exact failure the measurement module exists to
 * prevent.
 */
export function applyZoneEdit<T extends EditableZone>(zone: T, edit: ZoneEdit): T {
  const measurement = readMeasurement({
    length: edit.length,
    width: edit.width,
    linearConfirmed: edit.linear,
  });

  return {
    ...zone,
    name: edit.name.trim() || zone.name,
    lengthFt: measurement.lengthFt,
    widthFt: measurement.widthFt,
    measurementKind: measurement.kind,
    areaSqFt: measurement.areaSqFt,
    perimeterFt: measurement.perimeterFt,
    service: zone.service ? { ...zone.service, notes: edit.notes } : zone.service,
  };
}

/** A length typed with no width and nobody having said it is a run. */
export function needsLinearAnswer(edit: ZoneEdit): boolean {
  return readMeasurement({
    length: edit.length,
    width: edit.width,
    linearConfirmed: edit.linear,
  }).needsConfirmation;
}

function sizeWords(zone: EditableZone): string {
  if (zone.measurementKind === "linear" && zone.lengthFt != null) return `${zone.lengthFt} ft run`;
  if (zone.lengthFt != null && zone.widthFt != null) return `${zone.lengthFt} × ${zone.widthFt} ft`;
  return "not measured";
}

/**
 * What actually changed, in the words somebody would use out loud.
 *
 * One line per thing, so the record reads as a list of facts rather than two
 * snapshots for a person to diff in their head.
 */
export function describeZoneChange(before: EditableZone, after: EditableZone): string[] {
  const changes: string[] = [];

  if (before.name !== after.name) changes.push(`${before.name} renamed to ${after.name}`);

  const beforeSize = sizeWords(before);
  const afterSize = sizeWords(after);
  if (beforeSize !== afterSize) changes.push(`${after.name} measurement ${beforeSize} → ${afterSize}`);

  const beforeNotes = before.service?.notes ?? "";
  const afterNotes = after.service?.notes ?? "";
  if (beforeNotes !== afterNotes) {
    changes.push(afterNotes ? `${after.name} notes updated` : `${after.name} notes cleared`);
  }

  return changes;
}

/** Everything that changed across the whole evaluation, removals included. */
export function describeEvaluationChange(input: {
  before: EditableZone[];
  after: EditableZone[];
}): string[] {
  const afterById = new Map(input.after.map((z) => [z.id, z]));
  const beforeById = new Map(input.before.map((z) => [z.id, z]));

  const changes: string[] = [];
  for (const before of input.before) {
    const after = afterById.get(before.id);
    if (!after) {
      changes.push(`Removed ${before.name}`);
      continue;
    }
    changes.push(...describeZoneChange(before, after));
  }
  for (const after of input.after) {
    if (!beforeById.has(after.id)) changes.push(`Added ${after.name} (${sizeWords(after)})`);
  }
  return changes;
}

/**
 * An area entered from a phone call, with nothing drawn for it.
 *
 * No points on purpose. A rectangle invented in the office would show on the
 * client's site map as though somebody had stood there and measured it.
 */
export function manualZone(input: {
  id: string;
  name: string;
  serviceTypeId: string | null;
  length: string;
  width: string;
  linear: boolean;
  notes: string;
  color: string;
}): EditableZone {
  const measurement = readMeasurement({
    length: input.length,
    width: input.width,
    linearConfirmed: input.linear,
  });

  return {
    id: input.id,
    name: input.name.trim() || "New area",
    color: input.color,
    points: [],
    location: "",
    lengthFt: measurement.lengthFt,
    widthFt: measurement.widthFt,
    measurementKind: measurement.kind,
    areaSqFt: measurement.areaSqFt,
    perimeterFt: measurement.perimeterFt,
    service: input.serviceTypeId
      ? {
          typeId: input.serviceTypeId,
          values: {},
          notes: input.notes,
          photos: [],
          tools: [],
        }
      : null,
  } as EditableZone;
}

/** Whether an area added by hand is complete enough to save. */
export function manualZoneReady(input: { name: string; serviceTypeId: string | null }): boolean {
  return Boolean(input.name.trim() && input.serviceTypeId);
}
