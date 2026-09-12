import Link from "next/link";
import { Banknote, CalendarClock, HardHat, Handshake } from "lucide-react";

import type { TodayView } from "@/lib/today";

/**
 * The day, in the order somebody actually wants it.
 *
 * My Day already answers "what is on me" as a set of piles about the week.
 * This answers the narrower question somebody opens their phone with in the
 * evening: did we sell anything, did any money turn up, and is there anything
 * left before I stop.
 *
 * Sold and collected are two rows rather than one. They are different facts,
 * and adding them together is how a good day on paper turns out to be a quote
 * somebody accepted and never paid for.
 *
 * The headline does not flatter the day. Three visits and nothing sold reads
 * as three visits and nothing sold, because a line that says "busy day!" on a
 * day nobody bought anything is a line nobody will read twice.
 */
export function TodayPanel({ today }: { today: TodayView }) {
  if (today.quiet && today.owed === 0) {
    return (
      <section className="mb-4 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <p className="text-sm font-medium">{today.headline}</p>
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <p className="text-base font-semibold">{today.headline}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          icon={<Handshake className="h-4 w-4" />}
          label="Sold today"
          value={money(today.soldValue)}
          detail={soldDetail(today)}
        />
        <Tile
          icon={<Banknote className="h-4 w-4" />}
          label="Money in"
          value={money(today.moneyIn)}
          detail={`${today.money.length} payment${today.money.length === 1 ? "" : "s"}`}
        />
        <Tile
          icon={<CalendarClock className="h-4 w-4" />}
          label="Visits"
          value={String(today.visits.length)}
          detail="Booked today"
        />
        <Tile
          icon={<HardHat className="h-4 w-4" />}
          label="On site"
          value={String(today.onSite.length)}
          detail="Crew out"
        />
      </div>

      {/* Everybody's sales, with the seller on each line. One seller is
          named once, on the line; more than one gets the tally as well, so
          the owner can see who sold what without adding it up. */}
      {today.bySeller.length > 1 && (
        <Lines title="Sold today, by person">
          {today.bySeller.map((row) => (
            <Line
              key={row.profileId ?? "unassigned"}
              left={row.name}
              middle={`${row.count} job${row.count === 1 ? "" : "s"}`}
              right={money(row.value)}
            />
          ))}
        </Lines>
      )}

      {today.sold.length > 0 && (
        <Lines title="Sold today">
          {today.sold.map((row) => (
            <Line
              key={`${row.jobId}-${row.at}`}
              href={`/jobs/${row.jobId}`}
              left={row.customerName}
              middle={row.soldBy ? `${row.address} · ${row.soldBy}` : row.address}
              right={row.value == null ? "No total" : money(row.value)}
            />
          ))}
        </Lines>
      )}

      {today.money.length > 0 && (
        <Lines title="Money in today">
          {today.money.map((row, index) => (
            <Line
              key={`${row.label}-${index}`}
              left={row.label}
              middle={row.via}
              right={money(row.amount)}
            />
          ))}
        </Lines>
      )}

      {today.visits.length > 0 && (
        <Lines title="Visits today">
          {today.visits.map((row) => (
            <Line
              key={row.jobId}
              href={`/jobs/${row.jobId}`}
              left={at(row.at)}
              middle={`${row.customerName} · ${row.address}`}
              right={row.status.replace(/_/g, " ")}
            />
          ))}
        </Lines>
      )}

      {today.onSite.length > 0 && (
        <Lines title="Crew is on">
          {today.onSite.map((row) => (
            <Line key={row.jobId} href={`/jobs/${row.jobId}`} left={row.customerName} middle={row.address} />
          ))}
        </Lines>
      )}
    </section>
  );
}

function Tile({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function Lines({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="mt-1 divide-y divide-border rounded-lg border border-border">{children}</ul>
    </div>
  );
}

function Line({
  href,
  left,
  middle,
  right,
}: {
  href?: string;
  left: string;
  middle?: string;
  right?: string;
}) {
  const body = (
    <div className="flex items-baseline gap-2 px-2.5 py-1.5">
      <span className="shrink-0 text-sm font-medium">{left}</span>
      {middle && <span className="truncate text-xs text-muted-foreground">{middle}</span>}
      {right && <span className="ml-auto shrink-0 text-sm tabular-nums">{right}</span>}
    </div>
  );
  return <li>{href ? <Link href={href} className="block hover:bg-accent/50">{body}</Link> : body}</li>;
}

/** "3 jobs, whole team" when more than one person sold; the seller's name
 * when only one did, so the tile alone says whose day it was. */
function soldDetail(today: TodayView): string {
  const jobs = `${today.sold.length} job${today.sold.length === 1 ? "" : "s"}`;
  if (today.sold.length === 0) return jobs;
  if (today.bySeller.length === 1) return `${jobs} · ${today.bySeller[0].name}`;
  return `${jobs} · whole team`;
}

function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function at(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
