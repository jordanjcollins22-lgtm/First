"use client";

import { useMemo, useState } from "react";

import { colorForJobStatus } from "./attractor-colors";
import type { JobWithLocation } from "@/lib/data/jobs";

type Preset = "today" | "last30" | "thisQuarter" | "lastQuarter" | "custom";

function startOfQuarter(d: Date, offsetQuarters: number) {
  const q = Math.floor(d.getMonth() / 3) + offsetQuarters;
  const year = d.getFullYear() + Math.floor(q / 4);
  const month = ((q % 4) + 4) % 4;
  return new Date(year, month * 3, 1);
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function CalendarView({
  jobs,
  selectedJobId,
  onSelectJob,
}: {
  jobs: JobWithLocation[];
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
}) {
  const [preset, setPreset] = useState<Preset>("last30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (preset === "today") {
      const d = fmt(now);
      return { from: d, to: d };
    }
    if (preset === "last30") {
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      return { from: fmt(past), to: fmt(now) };
    }
    if (preset === "thisQuarter") {
      const start = startOfQuarter(now, 0);
      const end = startOfQuarter(now, 1);
      end.setDate(end.getDate() - 1);
      return { from: fmt(start), to: fmt(end) };
    }
    if (preset === "lastQuarter") {
      const start = startOfQuarter(now, -1);
      const end = startOfQuarter(now, 0);
      end.setDate(end.getDate() - 1);
      return { from: fmt(start), to: fmt(end) };
    }
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  const grouped = useMemo(() => {
    const filtered = jobs.filter((j) => {
      const day = j.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
    const map = new Map<string, JobWithLocation[]>();
    for (const job of filtered) {
      const day = job.created_at.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(job);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [jobs, from, to]);

  const PRESETS: { value: Preset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "last30", label: "Last 30 days" },
    { value: "thisQuarter", label: "This quarter" },
    { value: "lastQuarter", label: "Last quarter" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border p-3">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPreset(p.value)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              preset === p.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card/60 text-muted-foreground hover:bg-accent"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-7 rounded border border-border bg-card px-2 text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-7 rounded border border-border bg-card px-2 text-xs"
            />
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {grouped.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No appointments in this range.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map(([day, dayJobs]) => (
              <div key={day}>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  {new Date(day + "T00:00:00").toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                <div className="flex flex-col gap-1.5">
                  {dayJobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => onSelectJob(job.id)}
                      className={`flex items-center gap-2 rounded-lg border p-2 text-left text-sm ${
                        job.id === selectedJobId ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorForJobStatus(job.status) }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{job.property.customer.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{job.property.address}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
