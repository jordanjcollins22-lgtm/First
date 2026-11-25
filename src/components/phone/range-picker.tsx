"use client";

import Link, { useLinkStatus } from "next/link";

import type { DayRange } from "@/lib/data/zip-revenue";

const OPTIONS: [DayRange["key"], string][] = [
  ["30d", "Last 30 days"],
  ["month", "This month"],
  ["ytd", "Year to date"],
  ["custom", "Custom"],
];

/** Lights the tapped option at once, while the numbers load. */
function Label({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "vx-pending" : undefined}>{children}</span>;
}

/** Last 30 days · This month · Year to date · Custom, as links, so the page redraws with that window. Custom opens two dates and a Show button. */
export function RangePicker({ range, base = "/me", keep = {} }: { range: DayRange; base?: string; keep?: Record<string, string> }) {
  // Other things in the address (which app is open) ride along with the range.
  const extra = Object.entries(keep).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  return (
    <div className="vx-range">
      <div className="vx-seg" role="tablist" aria-label="Time period">
        {OPTIONS.map(([key, label]) => (
          <Link
            key={key}
            href={key === "custom" ? `${base}?range=custom&from=${range.from}&to=${range.to}${extra}` : `${base}?range=${key}${extra}`}
            className={range.key === key ? "on" : undefined}
            aria-current={range.key === key ? "true" : undefined}
            prefetch={false}
            scroll={false}
          >
            <Label>{label}</Label>
          </Link>
        ))}
      </div>
      {range.key === "custom" && (
        <form className="vx-dates" action={base} method="get">
          <input type="hidden" name="range" value="custom" />
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
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
