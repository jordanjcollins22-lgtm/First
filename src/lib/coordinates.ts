/**
 * Reading a location out of whatever somebody pasted.
 *
 * Every address on this system is placed by geocoding what the client typed,
 * and geocoding is wrong often enough to matter. New builds are not in the
 * database yet. A long driveway puts the pin on the road. Two houses on the
 * same lot share one address. And cul-de-sacs are the worst of the lot: a
 * street named Court frequently geocodes to the mouth of it rather than to
 * the house, so the whole close lands on one point and the satellite photo
 * comes back showing somebody else's roof.
 *
 * The evaluator is the one person who can fix that, because they are standing
 * on it. So they need a way to say where "it" actually is, and the way people
 * actually have a location to hand is a pasted string: a pin dropped in Google
 * Maps, a share sheet from Apple Maps, a pair of numbers read off a GPS. All
 * of those are accepted here rather than asking somebody in a driveway to
 * convert anything.
 *
 * Nothing here talks to a network. It reads text.
 */

export interface Point {
  lat: number;
  lng: number;
}

export type CoordinateParse =
  | { ok: true; point: Point; /** Worth querying out loud before saving. */ warning: string | null }
  | { ok: false; message: string };

/** Decimal degrees, the plain case: "39.51, -76.34". */
const DECIMAL_PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*[,;/\s]\s*(-?\d{1,3}(?:\.\d+)?)/;

/** Degrees, minutes and seconds with a hemisphere letter. */
const DMS =
  /(\d{1,3})\s*[°d:\s]\s*(\d{1,2})\s*['m:\s]\s*(\d{1,2}(?:\.\d+)?)\s*["s]?\s*([NSEW])/gi;

/** Decimal degrees with a hemisphere letter instead of a sign. */
const SIGNED_BY_LETTER = /(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NSEW])/gi;

/**
 * Anything outside this is not a property in this business's world.
 *
 * Not a validity check -- 76 degrees north is a real latitude -- but a
 * swapped-pair check. Somebody pasting "76.34, -39.51" has put longitude
 * first, and saving it silently drops a job in the Labrador Sea where nobody
 * will ever notice until a crew is sent.
 */
const PLAUSIBLE_LAT: [number, number] = [18, 72];

export function parseCoordinates(raw: string): CoordinateParse {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, message: "Paste a location or a pair of coordinates." };

  // A shortened link is a redirect, and following it would mean a network
  // call from a parser. Say so rather than failing as "not coordinates",
  // because the fix is one tap and nobody guesses it.
  if (/goo\.gl|maps\.app\.goo\.gl|bit\.ly|tinyurl/i.test(text)) {
    return {
      ok: false,
      message:
        "That is a shortened link, which does not carry the coordinates. Open it, then copy the numbers or the full link.",
    };
  }

  const fromUrl = fromMapUrl(text);
  const point = fromUrl ?? fromDms(text) ?? fromLettered(text) ?? fromDecimal(text);

  if (!point) {
    return {
      ok: false,
      message: "Could not read a location in that. Try a pair like 39.5123, -76.3456.",
    };
  }

  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { ok: false, message: "Those numbers do not make a location." };
  }
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
    return { ok: false, message: "That is outside the range coordinates come in." };
  }

  // Nobody in this business has a property on the equator at zero longitude.
  // It is what an empty GPS reads, and saving it puts a job in the Atlantic.
  if (point.lat === 0 && point.lng === 0) {
    return { ok: false, message: "That reads as zero, zero, which is a GPS that has not fixed yet." };
  }

  return { ok: true, point: round(point), warning: warn(point) };
}

/** Whether this looks like the two numbers went in the wrong order. */
function warn(point: Point): string | null {
  const latPlausible = point.lat >= PLAUSIBLE_LAT[0] && point.lat <= PLAUSIBLE_LAT[1];
  const swappedPlausible =
    Math.abs(point.lng) >= PLAUSIBLE_LAT[0] && Math.abs(point.lng) <= PLAUSIBLE_LAT[1];

  if (!latPlausible && swappedPlausible) {
    return "That looks like longitude and latitude the wrong way round. Check it before saving.";
  }
  if (!latPlausible) {
    return "That is a long way from anywhere this business works. Check it before saving.";
  }
  return null;
}

/**
 * A location out of a map link.
 *
 * Google and Apple both put it in the URL, in two or three different places
 * each depending on how the link was made. Read in the order of how specific
 * each one is: an explicit query parameter beats the view centre, because the
 * centre is wherever the map happened to be sitting.
 */
function fromMapUrl(text: string): Point | null {
  if (!/https?:\/\//i.test(text)) return null;

  // ?q=lat,lng and ?ll=lat,lng, used by both Google and Apple share sheets.
  const query = /[?&](?:q|ll|daddr|sll|center)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i.exec(
    text
  );
  if (query) return { lat: Number(query[1]), lng: Number(query[2]) };

  // Google's !3dlat!4dlng, which is where the pin actually is. Before the @
  // form on purpose: a long Google link carries both, and the @ part is only
  // wherever the map happened to be sitting when the link was made.
  const pin = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(text);
  if (pin) return { lat: Number(pin[1]), lng: Number(pin[2]) };

  // The map's centre, for a link that carries nothing better.
  const at = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(text);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };

  return null;
}

/** Degrees, minutes, seconds, as a phone's compass app shows them. */
function fromDms(text: string): Point | null {
  const found = [...text.matchAll(DMS)];
  if (found.length < 2) return null;

  const parts = found.slice(0, 2).map((match) => {
    const degrees = Number(match[1]) + Number(match[2]) / 60 + Number(match[3]) / 3600;
    const hemisphere = match[4].toUpperCase();
    const value = hemisphere === "S" || hemisphere === "W" ? -degrees : degrees;
    return { value, axis: hemisphere === "N" || hemisphere === "S" ? "lat" : "lng" };
  });

  const lat = parts.find((part) => part.axis === "lat");
  const lng = parts.find((part) => part.axis === "lng");
  if (!lat || !lng) return null;
  return { lat: lat.value, lng: lng.value };
}

/** Decimal degrees where the sign is a letter: "39.51 N, 76.34 W". */
function fromLettered(text: string): Point | null {
  const found = [...text.matchAll(SIGNED_BY_LETTER)];
  if (found.length < 2) return null;

  const parts = found.slice(0, 2).map((match) => {
    const magnitude = Math.abs(Number(match[1]));
    const hemisphere = match[2].toUpperCase();
    return {
      value: hemisphere === "S" || hemisphere === "W" ? -magnitude : magnitude,
      axis: hemisphere === "N" || hemisphere === "S" ? "lat" : "lng",
    };
  });

  const lat = parts.find((part) => part.axis === "lat");
  const lng = parts.find((part) => part.axis === "lng");
  if (!lat || !lng) return null;
  return { lat: lat.value, lng: lng.value };
}

/** Two plain numbers, latitude first, which is how everything writes them. */
function fromDecimal(text: string): Point | null {
  const match = DECIMAL_PAIR.exec(text);
  if (!match) return null;
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

/**
 * Six decimal places, which is about four inches.
 *
 * Keeping fifteen would be recording a precision no phone has and making two
 * readings of the same spot look like two different places.
 */
function round(point: Point): Point {
  return {
    lat: Math.round(point.lat * 1e6) / 1e6,
    lng: Math.round(point.lng * 1e6) / 1e6,
  };
}

/** A pair, written the way everything else writes them. */
export function formatCoordinates(point: Point): string {
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

/**
 * How far apart two points are, in feet.
 *
 * For telling an evaluator that where they are standing is four hundred feet
 * from where the address was placed, which is the whole argument for letting
 * them correct it. Flat earth arithmetic, which is exact enough at the scale
 * of one property and does not need a library.
 */
export function feetBetween(a: Point, b: Point): number {
  const FEET_PER_DEGREE_LAT = 364_000;
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLat = (a.lat - b.lat) * FEET_PER_DEGREE_LAT;
  const dLng = (a.lng - b.lng) * FEET_PER_DEGREE_LAT * Math.cos(midLat);
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
}

/**
 * Far enough from the recorded address to be worth saying out loud.
 *
 * A hundred feet is about the length of a suburban lot. Inside that, the pin
 * and the house are the same place for every purpose this app has. Outside it,
 * somebody has either walked to the back of a large property or the address
 * was placed on the wrong house.
 */
export const NOTABLE_DRIFT_FEET = 100;
