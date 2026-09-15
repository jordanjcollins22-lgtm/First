import Link from "next/link";

import type { DashboardSection } from "@/lib/dashboard";
import { formatJobNumber } from "@/lib/job-number";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(value: string): string {
  return new Date(value.length > 10 ? value : `${value}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * One half of the dashboard — the visits, or the work.
 *
 * Each pile is a <details>, which gets collapse and expand on a phone without
 * a byte of JavaScript or turning the page into a client component. Live piles
 * open by default, because a dashboard that hides its own contents until you
 * tap twelve times is a table of contents. Finished and cancelled piles start
 * closed — worth being able to check, not worth scrolling past.
 *
 * Empty piles still render, as one muted line. Knowing that nothing is on site
 * is information; a pile that vanishes leaves you wondering whether the screen
 * is broken or the day is quiet.
 */
export function DashboardSections<K extends string>({
  title,
  blurb,
  sections,
}: {
  title: string;
  blurb: string;
  sections: DashboardSection<K>[];
}) {
  const total = sections.reduce((sum, s) => sum + s.rows.length, 0);

  return (
    <section className="mb-6">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{total}</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{blurb}</p>

      <div className="flex flex-col gap-2">
        {sections.map((section) => {
          if (section.rows.length === 0) {
            return (
              <p
                key={section.key}
                className="rounded-xl border border-white/60 bg-card/40 px-3 py-2 text-sm text-muted-foreground backdrop-blur-md"
              >
                {section.label} — none
              </p>
            );
          }

          const late = section.rows.filter((r) => r.overdue).length;

          return (
            <details
              key={section.key}
              open={!section.history}
              className={`rounded-xl border backdrop-blur-md ${
                late > 0 ? "border-amber-400/70 bg-amber-50/60" : "border-white/60 bg-card/60"
              }`}
            >
              <summary className="flex cursor-pointer items-baseline justify-between gap-2 px-3 py-2.5">
                <span className="font-semibold">{section.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {late > 0 && <span className="mr-1.5 font-semibold text-amber-800">{late} late</span>}
                  {section.rows.length}
                </span>
              </summary>

              <p className="px-3 pb-2 text-[11px] text-muted-foreground">{section.blurb}</p>

              <ul className="flex flex-col gap-1.5 px-3 pb-3">
                {section.rows.map((row) => (
                  <li key={`${section.key}-${row.jobId}`}>
                    <Link
                      href={`/jobs/${row.jobId}`}
                      className="block rounded-lg border border-border bg-background/60 p-2.5 hover:bg-accent/50"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">
                          {row.customerName}
                          {formatJobNumber(row.jobNumber) && (
                            <span className="ml-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                              {formatJobNumber(row.jobNumber)}
                            </span>
                          )}
                        </span>
                        {row.value != null && row.value > 0 && (
                          <span className="shrink-0 text-xs tabular-nums">{money(row.value)}</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{row.address}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        {row.date && <span>{formatDate(row.date)}</span>}
                        {row.overdue && <span className="font-semibold text-amber-800">late</span>}
                        {row.personName && <span>{row.personName}</span>}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}
