import { cache } from "react";
import { CloudRain } from "lucide-react";

import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getWeatherPanelData } from "@/lib/data/weather-panel";
import { longDay } from "@/lib/weather-cascade/rules";
import { monthDayTime } from "@/lib/time-zone";
import { ProposalActions, WeatherSettingsForm } from "@/components/v2/panels/weather-panel-client";
import { OpenEntity } from "@/components/v2/panels/ops-open";

/**
 * Operations › Projects: the weather.
 *
 * What the forecast is about to do to the crews' week, what the cascade has
 * already moved, and the rules it moves by. A proposal that went over the
 * limits sits under Needs you for the owner or project lead to apply or
 * dismiss; everything inside the limits has already happened and shows on
 * the Weather screen. The rules are under Automatic. One load for all three.
 */

const loadWeather = cache(async () => {
  const organizationId = await getCurrentOrganizationId();
  return getWeatherPanelData(organizationId).catch((err) => {
    console.error("Weather panel failed to load:", err);
    return null;
  });
});

function Failed() {
  return <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Couldn&apos;t load the weather just now. Reload the page.</section>;
}

function NotSetUp() {
  return (
    <p className="rounded-xl border border-amber-400/60 bg-amber-50/70 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      The weather tables aren&apos;t set up yet (migration 0359). Nothing here will run until they are.
    </p>
  );
}

export async function WeatherNeedsPanel() {
  const data = await loadWeather();
  if (!data) return <Failed />;

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold">Weather</h3>
      {data.proposals.length === 0 ? (
        <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">Nothing waiting. Moves inside the limits happen on their own.</p>
      ) : (
        <ul className="grid gap-2">
          {data.proposals.map((p) => (
            <li key={p.key} className="rounded-xl border border-amber-400/60 bg-card p-3">
              <OpenEntity kind="ops.weather_move" id={p.ids[0]} className="text-sm font-semibold">
                Rain delay: {p.reason}
              </OpenEntity>
              {p.why && <p className="text-xs text-muted-foreground">{p.why}</p>}
              <ul className="mt-2 grid gap-1 text-sm">
                {p.moves.map((m, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{m.label}</span>
                    <span className="text-muted-foreground">
                      {longDay(m.from)} → {longDay(m.to)}
                      {m.cause === "chain" ? " (pushed along)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <ProposalActions ids={p.ids} />
            </li>
          ))}
        </ul>
      )}
      {data.openExceptions > data.proposals.length && (
        <p className="text-xs text-muted-foreground">
          {data.openExceptions} weather exception{data.openExceptions === 1 ? "" : "s"} open in all, including visits with no workable day in reach. They&apos;re on the jobs&apos; exception lists.
        </p>
      )}
    </div>
  );
}

export async function WeatherPanel() {
  const data = await loadWeather();
  if (!data) return <Failed />;

  const { settings } = data;
  const toldPct = data.movedLast30 > 0 ? Math.round((data.toldLast30 / data.movedLast30) * 100) : null;

  return (
    <section className="grid gap-4" aria-labelledby="weather-panel-title">
      <header className="flex items-start gap-3">
        <CloudRain className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 id="weather-panel-title" className="text-lg font-bold">
            Weather
          </h2>
          <p className="text-sm text-muted-foreground">
            Rained-out days move to the next workable day, and the crew&apos;s later days slide along with them. Clients and crews are told.
          </p>
        </div>
      </header>

      {!settings.ready && <NotSetUp />}

      {/* KPIs against target */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Waiting on you" value={String(data.proposals.length)} target="Target 0" good={data.proposals.length === 0} />
        <Kpi label="Clients told (30 days)" value={toldPct == null ? "—" : `${toldPct}%`} target="Target 100%" good={toldPct == null || toldPct === 100} />
        <Kpi label="Visits moved (30 days)" value={String(data.movedLast30)} target="Moved without a call" good />
        <Kpi label="Risky in next 4 days" value={String(data.risky.length)} target={settings.cascadeEnabled ? "Cascade is watching" : "Cascade is off"} good={settings.cascadeEnabled || data.risky.length === 0} />
      </div>

      {/* Upcoming risky days */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-2">
          <h3 className="text-sm font-semibold">Upcoming risky days</h3>
          <p className="text-xs text-muted-foreground">The next four days, judged by the same rules the cascade moves by.</p>
        </div>
        {data.forecastError ? (
          <p className="p-4 text-sm text-muted-foreground">The forecast couldn&apos;t be reached: {data.forecastError}</p>
        ) : data.risky.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No booked day breaks a rain rule in the next four days.</p>
        ) : (
          <ul className="divide-y">
            {data.risky.map((r) => (
              <li key={r.sessionId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2 text-sm">
                <span className="font-medium">{longDay(r.date)}</span>
                <OpenEntity kind="ops.work_day" id={r.sessionId}>
                  {r.label}
                </OpenEntity>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{r.workType}</span>
                <span className="w-full text-xs text-muted-foreground">
                  {r.reason}
                  {!r.movable && " · booked before the cascade was on, so it won't be moved automatically"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* What was moved */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-2">
          <h3 className="text-sm font-semibold">What was moved</h3>
          <p className="text-xs text-muted-foreground">The last 30 days.</p>
        </div>
        {data.recent.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing has been moved for weather yet.</p>
        ) : (
          <ul className="divide-y">
            {data.recent.map((m) => (
              <li key={m.id} className="grid gap-0.5 px-4 py-2 text-sm">
                <span className="flex flex-wrap gap-x-2">
                  <OpenEntity kind="ops.weather_move" id={m.id} className="font-medium">
                    {m.label}
                  </OpenEntity>
                  <span className="text-muted-foreground">
                    {longDay(m.from)} → {longDay(m.to)}
                  </span>
                  <span
                    className={
                      m.status === "applied"
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                        : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    }
                  >
                    {m.status === "applied" ? (m.clientsTold ? "moved · client told" : "moved") : m.status}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {m.reason} · {monthDayTime(m.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The rain rules and the cascade's switches. */
export async function WeatherAutoPanel() {
  const data = await loadWeather();
  if (!data) return <Failed />;
  const { settings } = data;

  return (
    <div className="grid gap-3">
      <h3 className="font-semibold">Weather cascade</h3>
      {!settings.ready && <NotSetUp />}
      <WeatherSettingsForm
        settings={{
          ready: settings.ready,
          cascadeEnabled: settings.cascadeEnabled,
          cascadeStartedAt: settings.cascadeStartedAt,
          coverExisting: settings.coverExisting,
          autoApply: settings.autoApply,
          maxAutoShiftDays: settings.maxAutoShiftDays,
          maxAutoMoves: settings.maxAutoMoves,
          workWeekdays: settings.workWeekdays,
          mowRainIn: settings.rules.mowRainIn,
          installRainIn: settings.rules.installRainIn,
          rainChanceMin: settings.rules.rainChanceMin,
          heavyRainIn: settings.rules.heavyRainIn,
          saturatedDays: settings.rules.saturatedDays,
          notifyClients: settings.notifyClients,
          notifyCrew: settings.notifyCrew,
          lastRunAt: settings.lastRunAt,
          lastRunSummary: summaryLine(settings.lastRunSummary),
        }}
      />
    </div>
  );
}

function summaryLine(summary: Record<string, unknown> | null): string | null {
  if (!summary) return null;
  if (typeof summary.skipped === "string") return summary.skipped;
  if (typeof summary.forecastError === "string") return `Forecast unavailable: ${summary.forecastError}`;
  const n = (k: string) => Number(summary[k] ?? 0);
  return `${n("sessionsRead")} visits checked, ${n("applied")} moved, ${n("proposed")} proposed, ${n("stuck")} with nowhere to go.`;
}

function Kpi({ label, value, target, good }: { label: string; value: string; target: string; good: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono text-2xl ${good ? "" : "text-amber-700 dark:text-amber-400"}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{target}</p>
    </div>
  );
}
