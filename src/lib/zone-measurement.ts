/**
 * What a zone's measurements actually say.
 *
 * Most work is measured length by width and priced by the square foot. Some
 * is not: pulling weeds out of a driveway's cracks, edging a bed, running a
 * trench. Those have a length and no meaningful width, and asking for one
 * gets either a made-up number or a blank.
 *
 * A blank width is ambiguous, and that is the whole problem this module
 * exists for. It means "this is a line, not a rectangle" or it means "I have
 * not finished typing" — and the difference is a price. So a length on its
 * own is not accepted until somebody says which it is. Nothing is derived
 * from a half-filled form.
 */

export type MeasurementKind =
  /** Length by width. Priced by the square foot. */
  | "area"
  /** A run with no width. Priced by the foot. */
  | "linear"
  /** Not enough entered yet to say. */
  | "none";

export interface MeasurementInput {
  /** What is in the length box. A string, because that is what a form has. */
  length: string | number | null | undefined;
  width: string | number | null | undefined;
  /** The evaluator has said out loud that this is a length with no width. */
  linearConfirmed?: boolean;
}

export interface Measurement {
  kind: MeasurementKind;
  lengthFt: number | null;
  widthFt: number | null;
  /**
   * Null on a linear measurement, always. A run of cracks has no area, and
   * inventing one is how a service priced by the square foot quietly bills
   * for a rectangle nobody measured.
   */
  areaSqFt: number | null;
  /**
   * Feet of work. The perimeter of the rectangle for an area measurement,
   * and the run itself for a linear one — physically the same quantity, so
   * a service priced by the foot works either way without knowing which it
   * was given.
   */
  perimeterFt: number | null;
  /** A length is in, a width is not, and nobody has said which it is yet. */
  needsConfirmation: boolean;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  // Zero is not a measurement. A zone somebody entered 0 into is a zone they
  // have not measured, and treating it as measured hides that.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Read a length and a width into everything that follows from them. */
export function readMeasurement(input: MeasurementInput): Measurement {
  const lengthFt = toNumber(input.length);
  const widthFt = toNumber(input.width);

  if (lengthFt != null && widthFt != null) {
    return {
      kind: "area",
      lengthFt,
      widthFt,
      areaSqFt: lengthFt * widthFt,
      perimeterFt: 2 * (lengthFt + widthFt),
      needsConfirmation: false,
    };
  }

  if (lengthFt != null) {
    if (!input.linearConfirmed) {
      // Deliberately gives nothing back. Deriving a linear measurement from a
      // half-typed form is how a 40 ft by 6 ft bed gets priced as 40 ft of
      // edging because somebody's thumb was still on the way to the width box.
      return {
        kind: "none",
        lengthFt,
        widthFt: null,
        areaSqFt: null,
        perimeterFt: null,
        needsConfirmation: true,
      };
    }
    return {
      kind: "linear",
      lengthFt,
      widthFt: null,
      areaSqFt: null,
      perimeterFt: lengthFt,
      needsConfirmation: false,
    };
  }

  // A width with no length is not a measurement of anything, and neither is
  // an empty form. Both are simply "not measured yet".
  return {
    kind: "none",
    lengthFt: null,
    widthFt,
    areaSqFt: null,
    perimeterFt: null,
    needsConfirmation: false,
  };
}

/** What the evaluator reads back under the boxes. */
export function describeMeasurement(measurement: Measurement): string | null {
  if (measurement.kind === "linear" && measurement.lengthFt != null) {
    return `= ${round(measurement.lengthFt)} linear ft`;
  }
  if (measurement.kind === "area" && measurement.areaSqFt != null && measurement.perimeterFt != null) {
    return `= ${round(measurement.areaSqFt)} sq ft · ${round(measurement.perimeterFt)} ft perimeter`;
  }
  return null;
}

function round(value: number): string {
  return Math.round(value).toLocaleString();
}

/**
 * Whether this zone can be saved as measured.
 *
 * An unconfirmed length is not a measurement, and letting it through is the
 * same as guessing on the evaluator's behalf.
 */
export function measurementIsSettled(measurement: Measurement): boolean {
  return !measurement.needsConfirmation;
}

/**
 * Which kind an already-saved zone was.
 *
 * Stored zones carry the kind from now on, but the ones already on file do
 * not. Those are read back from their numbers: a length with no width and no
 * area was a run, and everything else was a rectangle. Guessing here is safe
 * in a way that guessing at entry time is not — the evaluator has already
 * answered, and this only recovers which answer they gave.
 */
export function kindOfSaved(zone: {
  measurementKind?: MeasurementKind | null;
  lengthFt?: number | null;
  widthFt?: number | null;
  areaSqFt?: number | null;
}): MeasurementKind {
  if (zone.measurementKind === "area" || zone.measurementKind === "linear") {
    return zone.measurementKind;
  }
  const hasLength = (zone.lengthFt ?? 0) > 0;
  const hasWidth = (zone.widthFt ?? 0) > 0;
  const hasArea = (zone.areaSqFt ?? 0) > 0;

  if (hasLength && !hasWidth && !hasArea) return "linear";
  if (hasArea || (hasLength && hasWidth)) return "area";
  return "none";
}
