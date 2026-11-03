import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";

import type { PeopleDashboard } from "@/lib/data/people";
import { ROLE_LABEL, STAGE_LABEL, type DashboardCounts } from "@/lib/people/lifecycle";
import { PeopleNav } from "@/components/people/people-nav";

const TILES: { key: keyof DashboardCounts; label: string; filter?: string }[] = [
  { key: "newApplicants", label: "New applicants" },
  { key: "awaitingScreening", label: "Awaiting screening" },
  { key: "interviewsPending", label: "Interviews pending" },
  { key: "offersPending", label: "Offers pending" },
  { key: "awaitingOnboarding", label: "Awaiting onboarding" },
  { key: "inTraining", label: "In training" },
  { key: "evaluationsPending", label: "Evaluations pending" },
  { key: "readyForDeployment", label: "Ready for deployment" },
  { key: "requiringAttention", label: "Requiring attention" },
];

function roleName(key: string | null): string {
  return key && key in ROLE_LABEL ? ROLE_LABEL[key as keyof typeof ROLE_LABEL] : "Position not set";
}

export function PeopleDashboardView({ dashboard }: { dashboard: PeopleDashboard }) {
  const active = dashboard.people.filter((p) => p.status === "active");
  const attention = active.filter((p) => p.needsAttention);
  const others = active.filter((p) => !p.needsAttention);
  const closed = dashboard.people.filter((p) => p.status !== "active").length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everyone from application to offboarding, with what&apos;s missing and what happens next.</p>
      </header>
      <PeopleNav active="dashboard" />

      {!dashboard.ready ? (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          People needs its database update. Run migration 0400_people_lifecycle.sql, then reload this page.
        </p>
      ) : (
        <>
          <section aria-label="Overview" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TILES.map((t) => (
              <div key={t.key} className={`rounded-xl border p-3 ${t.key === "requiringAttention" && dashboard.counts[t.key] > 0 ? "border-amber-300 bg-amber-50 text-amber-950" : "border-border bg-card"}`}>
                <p className="text-2xl font-semibold tabular-nums">{dashboard.counts[t.key]}</p>
                <p className="text-xs">{t.label}</p>
              </div>
            ))}
          </section>
          {attention.length > 0 && (
            <section className="space-y-2">
              <h2 className="flex items-center gap-2 text-base font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> Requires attention</h2>
              <PersonList people={attention} />
            </section>
          )}
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Everyone active</h2>
            {others.length ? <PersonList people={others} /> : <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No one else is active right now.</p>}
          </section>
          {closed > 0 && <p className="text-xs text-muted-foreground">{closed} closed records are kept for history.</p>}
        </>
      )}
    </div>
  );
}

function PersonList({ people }: { people: PeopleDashboard["people"] }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {people.map((p) => (
        <li key={p.id}>
          <Link href={`/admin/people/${p.id}`} className="flex items-center gap-3 p-3 hover:bg-muted">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground">{roleName(p.position)} · {STAGE_LABEL[p.stage]}{p.ownerName ? ` · ${p.ownerName}` : ""}</span>
              <span className="mt-0.5 block text-sm">{p.nextAction}</span>
            </span>
            {p.overdue > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{p.overdue} overdue</span>}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
