import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";

import type { ModuleRow } from "@/lib/data/people";
import { ROLE_LABEL } from "@/lib/people/lifecycle";
import { PeopleNav } from "@/components/people/people-nav";

const STATUS = { draft: "Draft: not assigned yet", published: "Published", retired: "Retired" };

export function TrainingLibrary({ modules }: { modules: ModuleRow[] }) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Training library</h1>
          <p className="mt-1 text-sm text-muted-foreground">Each module has the ten standard parts. Only published modules are assigned to people.</p>
        </div>
        <Link href="/admin/people/training/new" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Plus className="h-4 w-4" aria-hidden /> New module</Link>
      </header>
      <PeopleNav active="training" />
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {modules.map((m) => (
          <li key={m.id}>
            <Link href={`/admin/people/training/${m.id}`} className="flex items-center gap-3 p-3 hover:bg-muted">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{m.title}</span>
                <span className="block text-xs text-muted-foreground">{m.positions.length ? m.positions.map((p) => ROLE_LABEL[p as keyof typeof ROLE_LABEL] ?? p).join(", ") : "All positions"} · {m.competency_label}</span>
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.status === "published" ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"}`}>{STATUS[m.status]}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
