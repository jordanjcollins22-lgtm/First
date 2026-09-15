import { describeWeather, isRoughDay, weatherEmoji } from "@/lib/weather";
import type { DailyForecast } from "@/lib/weather";

/** Seven days across, scrolling sideways on a phone rather than wrapping
 * into a grid that loses the sense of a week in order. */
export function ForecastStrip({ days }: { days: DailyForecast[] }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {days.map((day, i) => {
        const rough = isRoughDay(day);
        return (
          <div
            key={day.date}
            className={`min-w-[104px] flex-1 rounded-lg border px-2 py-2 text-center ${
              rough ? "border-amber-400/70 bg-amber-50/60" : "border-white/60 bg-background/50"
            }`}
          >
            <p className="text-xs font-semibold">
              {i === 0
                ? "Today"
                : new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}
            </p>
            <p className="my-0.5 text-2xl leading-none" aria-hidden>
              {weatherEmoji(day.code)}
            </p>
            <p className="text-[11px] text-muted-foreground">{describeWeather(day.code)}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {day.tempMax}° <span className="font-normal text-muted-foreground">{day.tempMin}°</span>
            </p>
            {day.precipChance > 0 && (
              <p className="text-[11px] text-muted-foreground tabular-nums">{day.precipChance}% rain</p>
            )}
            {day.windMax >= 20 && (
              <p className="text-[11px] text-muted-foreground tabular-nums">{day.windMax} mph wind</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
