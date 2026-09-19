/**
 * How many houses are actually in an area you have drawn.
 *
 * Door hangers are ordered and carried in boxes, and the question that decides
 * both is "how many doors is that?". Drawing a circle on a map does not answer
 * it, so somebody guesses, and the guess is wrong in the expensive direction:
 * five hundred printed for a street of ninety, or ninety carried to a
 * subdivision of four hundred with the crew walking back to the truck.
 *
 * What this can honestly count is what the app knows about — parcels imported
 * into the prospect list, plus properties of existing clients. Where a parcel
 * list has been imported for the county that is the real number. Where one has
 * not, it is an undercount, and saying so is the difference between a useful
 * figure and a misleading one.
 */

import * as turf from "@turf/turf";

import { geometryToPolygon } from "@/lib/attractor-geometry";
import type { AttractorGeometry, AttractorGeometryType } from "@/types/domain";

export type AddressSource = "prospect" | "client";

export interface AreaAddress {
  lat: number | null;
  lng: number | null;
  zip: string | null;
  source: AddressSource;
  /** Already a customer of ours — worth separating, because a hanger on their
   * door is a different conversation from one on a stranger's. */
  doNotContact?: boolean;
}

export interface AreaCoverage {
  /** Everything inside the shape that we hold an address for. */
  total: number;
  /** Parcels from the prospect list — strangers. */
  prospects: number;
  /** Properties of people we have already worked for. */
  clients: number;
  /** Inside the area but marked do-not-contact. Subtracted from `toHang`. */
  doNotContact: number;
  /** What to actually print and carry. */
  toHang: number;
  /** True when nothing in the area came from an imported parcel list, which
   * means this is a floor, not a count. */
  countIsFloor: boolean;
}

const EMPTY: AreaCoverage = {
  total: 0,
  prospects: 0,
  clients: 0,
  doNotContact: 0,
  toHang: 0,
  countIsFloor: true,
};

function normaliseZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  // Five digits, so a ZIP+4 on an imported row still matches a plain one.
  const match = zip.trim().match(/^\d{5}/);
  return match ? match[0] : null;
}

/**
 * Whether one address falls inside the drawn area.
 *
 * Zip lists are matched on the zip rather than geometry, because that is what
 * they are — there is no shape to be inside. Everything else needs a real
 * coordinate: an address the geocoder never resolved cannot be placed, and
 * counting it anyway would inflate the figure people order boxes against.
 */
export function addressInArea(
  address: Pick<AreaAddress, "lat" | "lng" | "zip">,
  type: AttractorGeometryType,
  geometry: AttractorGeometry
): boolean {
  if (type === "zip_list") {
    const zips = (geometry as { zips?: string[] }).zips ?? [];
    const wanted = new Set(zips.map(normaliseZip).filter((z): z is string => z !== null));
    const zip = normaliseZip(address.zip);
    return zip !== null && wanted.has(zip);
  }

  if (address.lat == null || address.lng == null) return false;

  const polygon = geometryToPolygon(type, geometry);
  if (!polygon) return false;
  try {
    return turf.booleanPointInPolygon([address.lng, address.lat], polygon);
  } catch {
    return false;
  }
}

/**
 * The count, split so somebody can act on it.
 *
 * Do-not-contact addresses are counted and then subtracted rather than
 * silently dropped: somebody who asked us to stop is still a door on that
 * street, and the walker needs to know to skip it rather than wonder why the
 * numbers do not add up.
 */
export function coverageFor(
  type: AttractorGeometryType,
  geometry: AttractorGeometry,
  addresses: AreaAddress[]
): AreaCoverage {
  const inside = addresses.filter((a) => addressInArea(a, type, geometry));
  if (inside.length === 0) return EMPTY;

  const prospects = inside.filter((a) => a.source === "prospect").length;
  const clients = inside.filter((a) => a.source === "client").length;
  const doNotContact = inside.filter((a) => a.doNotContact).length;

  return {
    total: inside.length,
    prospects,
    clients,
    doNotContact,
    toHang: inside.length - doNotContact,
    // With no imported parcels in the shape, all we are counting is our own
    // client book, which is a fraction of the street by definition.
    countIsFloor: prospects === 0,
  };
}

/**
 * The sentence to put under the number.
 *
 * A bare count invites somebody to order exactly that many. Saying which kind
 * of count it is turns it into either a figure to order against or a prompt to
 * go and import the parcels first.
 */
export function describeCoverage(coverage: AreaCoverage): string {
  if (coverage.total === 0) {
    return "No addresses on file inside this area yet. Import the parcels for it on the Leads page to get a real count.";
  }
  if (coverage.countIsFloor) {
    return "These are only properties we have already worked at — the real number of doors will be higher. Import the parcels for this area to count them.";
  }
  const skipping =
    coverage.doNotContact > 0
      ? ` Skip ${coverage.doNotContact}, ${coverage.doNotContact === 1 ? "who has" : "who have"} asked not to be contacted.`
      : "";
  return `Counted from ${coverage.prospects} imported ${coverage.prospects === 1 ? "parcel" : "parcels"} and ${coverage.clients} of our own ${coverage.clients === 1 ? "property" : "properties"} inside the area.${skipping}`;
}
