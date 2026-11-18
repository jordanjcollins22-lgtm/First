import Link from "next/link";

import type { DayRange } from "@/lib/data/zip-revenue";

const OPTIONS: [DayRange["key"], string][] = [
  ["month", "This month"],
  ["90d", "Last 90 days"],
  ["custom", "Custom"],
];

/** This month · Last 90 days · Custom, as links, so the page redraws with that window. Custom opens two dates and a Show button. */
export function RangePicker({ range, base = "/me" }: { range: DayRange; base?: string }) {
  return (
    <div className="vx-range">
      <div className="vx-seg" role="tablist" aria-label="Time period">
        {OPTIONS.map(([key, label]) => (
          <Link
            key={key}
            href={key === "custom" ? `${base}?range=custom&from=${range.from}&to=${range.to}` : `${base}?range=${key}`}
            className={range.key === key ? "on" : undefined}
            aria-current={range.key === key ? "true" : undefined}
            scroll={false}
          >
            {label}
          </Link>
        ))}
      </div>
      {range.key === "custom" && (
        <form className="vx-dates" action={base} method="get">
          <input type="hidden" name="range" value="custom" />
          <label>
            From
            <input type="date" name="from" defaultValue={range.from} required />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={range.to} required />
          </label>
          <button type="submit">Show</button>
        </form>
      )}
    </div>
  );
}
