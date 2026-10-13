/**
 * The forecast the cascade decides on: the app's existing weather source,
 * Open-Meteo (no key, no account), asked for a little more than the weather
 * page needs.
 *
 * Two things the page does not ask for. The last two days, because "the
 * ground is still soaked from Saturday" is a rule and needs Saturday's rain;
 * and snowfall, because a snow day is a reason to stop mowing and to start a
 * snow event. One request for every place, as fetchForecasts does.
 *
 * Throws when the service does not answer. The cron treats a missing
 * forecast as "move nothing", never as "no rain".
 */

import { fetchJson } from "@/lib/resilient-fetch";
import type { DayWeather } from "@/lib/weather-cascade/rules";

export interface ForecastPoint {
  key: string;
  lat: number;
  lng: number;
}

interface OpenMeteoDaily {
  daily?: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_probability_max: (number | null)[];
    rain_sum: (number | null)[];
    showers_sum?: (number | null)[];
    snowfall_sum: (number | null)[];
  };
}

/**
 * Places a few miles apart share a forecast, so the points are rounded to
 * about five miles before asking. Forty lawns on one side of the county are
 * one request's worth of weather, not forty.
 */
export function locationKeyFor(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const round = (n: number) => (Math.round(n * 14) / 14).toFixed(3);
  return `${round(lat)},${round(lng)}`;
}

export function pointFromKey(key: string): ForecastPoint {
  const [lat, lng] = key.split(",").map(Number);
  return { key, lat, lng };
}

export async function fetchCascadeForecast(points: ForecastPoint[], today: string, forecastDays = 4, pastDays = 2): Promise<Map<string, Map<string, DayWeather>>> {
  const out = new Map<string, Map<string, DayWeather>>();
  if (points.length === 0) return out;

  // Open-Meteo takes a long list of coordinates, but a URL has limits; fifty
  // at a time keeps every request comfortably short.
  for (let i = 0; i < points.length; i += 50) {
    const batch = points.slice(i, i + 50);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", batch.map((p) => p.lat).join(","));
    url.searchParams.set("longitude", batch.map((p) => p.lng).join(","));
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,rain_sum,showers_sum,snowfall_sum"
    );
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("precipitation_unit", "inch");
    url.searchParams.set("timezone", "America/New_York");
    url.searchParams.set("forecast_days", String(Math.min(16, Math.max(1, forecastDays))));
    url.searchParams.set("past_days", String(Math.min(7, Math.max(0, pastDays))));

    const outcome = await fetchJson<OpenMeteoDaily | OpenMeteoDaily[]>(url, { timeoutMs: 5_000, attempts: 2 });
    if (!outcome.ok) throw new Error(`Weather service unavailable: ${outcome.message}`);
    const entries = Array.isArray(outcome.value) ? outcome.value : [outcome.value];

    batch.forEach((point, index) => {
      const daily = entries[index]?.daily;
      const days = new Map<string, DayWeather>();
      (daily?.time ?? []).forEach((date, d) => {
        const rain = (daily?.rain_sum[d] ?? 0) + (daily?.showers_sum?.[d] ?? 0);
        days.set(date, {
          date,
          rainIn: Math.round(rain * 100) / 100,
          // A day that has happened rained or it didn't: what fell is a
          // certainty, whatever the forecast said that morning.
          rainChance: date < today ? (rain > 0 ? 100 : 0) : (daily?.precipitation_probability_max[d] ?? (rain > 0 ? 100 : 0)),
          snowIn: Math.round((daily?.snowfall_sum[d] ?? 0) * 10) / 10,
          code: daily?.weather_code[d] ?? 0,
          tempMinF: Math.round(daily?.temperature_2m_min[d] ?? 50),
          tempMaxF: Math.round(daily?.temperature_2m_max[d] ?? 60),
        });
      });
      out.set(point.key, days);
    });
  }
  return out;
}
