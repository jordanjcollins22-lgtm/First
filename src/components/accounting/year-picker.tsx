import Link from "next/link";

import { cn } from "@/lib/utils";

export function YearPicker({ year, basePath, extra = "" }: { year: number; basePath: string; extra?: string }) {
  const current = new Date().getFullYear();
  const years = [current, current - 1, current - 2];
  return (
    <div className="flex gap-1 rounded-md border border-border bg-card p-1 text-sm">
      {years.map((y) => (
        <Link
          key={y}
          href={`${basePath}?year=${y}${extra}`}
          className={cn("rounded px-3 py-1", y === year ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
        >
          {y}
        </Link>
      ))}
    </div>
  );
}

export function AccountingNav({ year, active }: { year: number; active: "overview" | "transactions" | "schedule-c" }) {
  const tabs = [
    { key: "overview", label: "Overview & import", href: `/accounting?year=${year}` },
    { key: "transactions", label: "Transactions", href: `/accounting/transactions?year=${year}` },
    { key: "schedule-c", label: "Schedule C", href: `/accounting/schedule-c?year=${year}` },
  ] as const;
  return (
    <nav className="mb-6 flex gap-4 border-b border-border text-sm font-medium">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn("-mb-px border-b-2 px-1 pb-2", t.key === active ? "border-primary text-primary" : "border-transparent hover:text-primary")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
