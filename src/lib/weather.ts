/** Weather for the places we work out of.
 *
 * Open-Meteo needs no API key and no account, which is why it's used here
 * rather than one of the keyed services — one less secret to keep in sync
 * across Vercel and everyone's .env.local.
 *
 * Plain module, not a "use server" one: the page calls it directly during
 * render and every export here is a helper, not an action.
 */

export interface WeatherPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface DailyForecast {
  /** ISO date, already in the location's own timezone. */
  date: string;
  code: number;
  tempMax: number;
  tempMin: number;
  precipChance: number;
  precipAmount: number;
  windMax: number;
}

export interface LocationForecast {
  id: string;
  name: string;
  lat: number;
  lng: number;
  current: { temp: number; code: number; wind: number; precip: number } | null;
  days: DailyForecast[];
}

export interface WeatherOverview {
  locations: LocationForecast[];
  /** True when every location's forecast is close enough to call it one
   * forecast — which is the normal case for a crew working one metro area. */
  uniform: boolean;
  /** Plain-language reason the forecasts were judged different. Empty when
   * uniform. */
  differences: string[];
  /** The forecast to show when uniform — the first location's, since by
   * definition they all agree. */
  shared: LocationForecast | null;
}

/** WMO weather codes, grouped so "light rain" and "moderate rain" count as
 * the same kind of day when deciding whether two locations agree. */
type ConditionGroup = "clear" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "showers" | "thunder";

function conditionGroup(code: number): ConditionGroup {
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 86) return "showers";
  if (code >= 95) return "thunder";
  return "cloud";
}

const CODE_LABELS: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms with hail",
  99: "Thunderstorms with hail",
};

export function describeWeather(code: number): string {
  return CODE_LABELS[code] ?? "Unsettled";
}

/** Emoji rather than an icon set — it reads fine on a phone in sunlight and
 * costs nothing to load. */
export function weatherEmoji(code: number): string {
  switch (conditionGroup(code)) {
    case "clear":
      return code === 0 ? "☀️" : "🌤️";
    case "cloud":
      return code === 2 ? "⛅" : "☁️";
    case "fog":
      return "🌫️";
    case "drizzle":
      return "🌦️";
    case "rain":
      return "🌧️";
    case "snow":
      return "🌨️";
    case "showers":
      return "🌦️";
    case "thunder":
      return "⛈️";
  }
}

/** Is this a day you'd not want a crew outside? Used to flag the schedule. */
export function isRoughDay(day: DailyForecast): boolean {
  const group = conditionGroup(day.code);
  return (
    group === "thunder" ||
    group === "snow" ||
    day.precipChance >= 60 ||
    day.precipAmount >= 0.25 ||
    day.windMax >= 25 ||
    day.tempMax >= 95 ||
    day.tempMin <= 28
  );
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  current?: {
    temperature_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    precipitation: number;
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: (number | null)[];
    wind_speed_10m_max: (number | null)[];
  };
}

/**
 * One request for every location — Open-Meteo accepts comma-separated
 * coordinates and answers with an array in the same order.
 *
 * Cached for half an hour: the forecast doesn't change faster than that, and
 * it keeps a page refresh from hitting the API every time.
 */
export async function fetchForecasts(points: WeatherPoint[]): Promise<LocationForecast[]> {
  if (points.length === 0) return [];

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", points.map((p) => p.lat).join(","));
  url.searchParams.set("longitude", points.map((p) => p.lng).join(","));
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m,precipitation");
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max"
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");

  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);

  const body = (await res.json()) as OpenMeteoResponse | OpenMeteoResponse[];
  const entries = Array.isArray(body) ? body : [body];

  return points.map((point, i) => {
    const entry = entries[i];
    const daily = entry?.daily;
    const days: DailyForecast[] = (daily?.time ?? []).map((date, d) => ({
      date,
      code: daily?.weather_code[d] ?? 0,
      tempMax: Math.round(daily?.temperature_2m_max[d] ?? 0),
      tempMin: Math.round(daily?.temperature_2m_min[d] ?? 0),
      precipChance: Math.round(daily?.precipitation_probability_max[d] ?? 0),
      precipAmount: daily?.precipitation_sum[d] ?? 0,
      windMax: Math.round(daily?.wind_speed_10m_max[d] ?? 0),
    }));

    return {
      id: point.id,
      name: point.name,
      lat: point.lat,
      lng: point.lng,
      current: entry?.current
        ? {
            temp: Math.round(entry.current.temperature_2m),
            code: entry.current.weather_code,
            wind: Math.round(entry.current.wind_speed_10m),
            precip: entry.current.precipitation,
          }
        : null,
      days,
    };
  });
}

// How far apart two locations can be before it's worth showing them
// separately. Generous on purpose — a few degrees between one side of the
// county and the other isn't news.
const TEMP_TOLERANCE_F = 5;
const PRECIP_TOLERANCE_POINTS = 25;

/**
 * Decides whether these locations get one forecast or several.
 *
 * This compares the actual forecasts rather than the distance between the
 * pins: two yards twenty miles apart usually share a forecast, and
 * occasionally one sits under a storm the other misses. Distance would get
 * both of those wrong.
 */
export function summarizeAgreement(locations: LocationForecast[]): WeatherOverview {
  if (locations.length <= 1) {
    return { locations, uniform: true, differences: [], shared: locations[0] ?? null };
  }

  const differences: string[] = [];
  const dayCount = Math.min(...locations.map((l) => l.days.length));

  for (let d = 0; d < dayCount; d++) {
    const days = locations.map((l) => l.days[d]);
    const label = d === 0 ? "Today" : new Date(`${days[0].date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });

    const groups = new Set(days.map((day) => conditionGroup(day.code)));
    if (groups.size > 1) {
      const worst = days.reduce((a, b) => (b.precipChance > a.precipChance ? b : a));
      const calmest = days.reduce((a, b) => (b.precipChance < a.precipChance ? b : a));
      const worstAt = locations[days.indexOf(worst)].name;
      const calmestAt = locations[days.indexOf(calmest)].name;
      differences.push(`${label}: ${describeWeather(worst.code).toLowerCase()} at ${worstAt}, ${describeWeather(calmest.code).toLowerCase()} at ${calmestAt}`);
      continue;
    }

    const highs = days.map((day) => day.tempMax);
    if (Math.max(...highs) - Math.min(...highs) > TEMP_TOLERANCE_F) {
      differences.push(`${label}: highs range ${Math.min(...highs)}° to ${Math.max(...highs)}° across locations`);
      continue;
    }

    const chances = days.map((day) => day.precipChance);
    if (Math.max(...chances) - Math.min(...chances) > PRECIP_TOLERANCE_POINTS) {
      differences.push(`${label}: rain chance ranges ${Math.min(...chances)}% to ${Math.max(...chances)}%`);
    }
  }

  return {
    locations,
    uniform: differences.length === 0,
    differences,
    shared: locations[0] ?? null,
  };
}

/** Straight-line miles, so the page can say how spread out the locations
 * are without pretending to know driving distance. */
export function milesBetween(a: WeatherPoint, b: WeatherPoint): number {
  const R = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The widest gap between any two locations. */
export function widestSpreadMiles(points: WeatherPoint[]): number {
  let widest = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      widest = Math.max(widest, milesBetween(points[i], points[j]));
    }
  }
  return widest;
}
