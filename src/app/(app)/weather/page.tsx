import { isSupabaseConfigured } from "@/lib/env";
import { listBusinessLocations } from "@/lib/data/locations";
import {
  describeWeather,
  fetchForecasts,
  summarizeAgreement,
  weatherEmoji,
  widestSpreadMiles,
} from "@/lib/weather";
import { ForecastStrip } from "@/components/weather/forecast-strip";
import { WeatherMap } from "@/components/weather/weather-map";

// Weather isn't sensitive and everyone working outside needs it, so this is
// open to anyone signed in rather than gated behind a tab permission.
export default async function WeatherPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  const locations = await listBusinessLocations();

  if (locations.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Weather</h1>
        <p className="text-muted-foreground">
          Add a business location on Project Data and its forecast will show up here.
        </p>
      </div>
    );
  }

  const points = locations.map((l) => ({ id: l.id, name: l.name, lat: l.lat, lng: l.lng }));

  let overview: Awaited<ReturnType<typeof fetchForecasts>> | null = null;
  try {
    overview = await fetchForecasts(points);
  } catch {
    overview = null;
  }

  if (!overview) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Weather</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t reach the weather service just now. Reload in a minute.
        </p>
      </div>
    );
  }

  const summary = summarizeAgreement(overview);
  const spread = widestSpreadMiles(points);
  const shared = summary.shared;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Weather</h1>
      <p className="mb-6 text-muted-foreground">
        {locations.length === 1
          ? locations[0].name
          : summary.uniform
            ? `Same across all ${locations.length} locations${spread >= 1 ? `, ${Math.round(spread)} miles apart at the widest` : ""}.`
            : `Different across your ${locations.length} locations — broken out below.`}
      </p>

      {/* One forecast when they agree, which is the usual case. */}
      {summary.uniform && shared && (
        <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
          {shared.current && (
            <div className="mb-3 flex items-center gap-3">
              <span className="text-4xl leading-none" aria-hidden>
                {weatherEmoji(shared.current.code)}
              </span>
              <div>
                <p className="text-2xl font-bold tabular-nums">{shared.current.temp}°</p>
                <p className="text-sm text-muted-foreground">
                  {describeWeather(shared.current.code)} · wind {shared.current.wind} mph
                </p>
              </div>
            </div>
          )}
          <ForecastStrip days={shared.days} />
          {locations.length > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {locations.map((l) => l.name).join(" · ")}
            </p>
          )}
        </section>
      )}

      {/* Split out only when the forecasts actually disagree. */}
      {!summary.uniform && (
        <>
          <section className="mb-4 rounded-xl border border-amber-400/70 bg-amber-50/60 p-4">
            <h2 className="mb-1 text-sm font-semibold">Where they differ</h2>
            <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
              {summary.differences.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </section>

          <div className="mb-6 space-y-4">
            {summary.locations.map((location) => (
              <section
                key={location.id}
                className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">{location.name}</h2>
                  {location.current && (
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {weatherEmoji(location.current.code)} {location.current.temp}° ·{" "}
                      {describeWeather(location.current.code)}
                    </p>
                  )}
                </div>
                <ForecastStrip days={location.days} />
              </section>
            ))}
          </div>
        </>
      )}

      <WeatherMap locations={overview} />
    </div>
  );
}
