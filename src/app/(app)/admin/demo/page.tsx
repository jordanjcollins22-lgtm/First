import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { getRealProfile } from "@/lib/data/team";
import { getDemoRoles } from "@/lib/data/demo";
import { openDemo } from "@/lib/actions/demo-actions";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { BackLink } from "@/components/ui/back-link";
import { cn } from "@/lib/utils";

/**
 * The demo: every role, the people who have it and what each of them has on,
 * and a way into the app as any one of them, with live data and nothing
 * saved or sent.
 */
export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const real = await getRealProfile();
  if (!real?.roles.includes("admin")) redirect("/my-day");

  const roles = await getDemoRoles();
  const { role: asked } = await searchParams;
  const current = roles.find((r) => r.name === asked) ?? roles.find((r) => r.people.length > 0) ?? roles[0] ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <div className="mb-3">
        <BackLink fallbackHref="/my-day?tab=system" />
      </div>
      <h1 className="mb-1 text-2xl font-bold">Demo</h1>
      <p className="mb-5 text-muted-foreground">
        Pick a role, then a person with it, and the app opens as them: their day, their jobs, what they can see. It is live
        data, and nothing you do in the demo is saved or sent. A bar at the top swaps to somebody else or closes it.
      </p>

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Roles">
        {roles.map((r) => (
          <Link
            key={r.name}
            href={`/admin/demo?role=${encodeURIComponent(r.name)}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm capitalize",
              current?.name === r.name ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {r.name} <span className="text-xs opacity-70">{r.people.length}</span>
          </Link>
        ))}
      </nav>

      {!current ? (
        <p className="text-sm text-muted-foreground">No roles yet.</p>
      ) : current.people.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">
          Nobody has the <span className="capitalize">{current.name}</span> role yet. Give it to somebody on the Team page to open it here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {current.people.map((person) => (
            <li key={person.id} className="rounded-xl border border-border bg-card/70 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{person.name}</p>
                  <p className="text-xs capitalize text-muted-foreground">{person.roles.join(", ")}</p>
                </div>
                <form action={openDemo.bind(null, person.id)}>
                  <button type="submit" className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
                    <Eye className="h-4 w-4" />
                    {person.id === real.id ? "Open as yourself" : `Open as ${person.name.split(" ")[0]}`}
                  </button>
                </form>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label="Today" value={person.today === 0 ? "No visits" : `${person.today} ${person.today === 1 ? "visit" : "visits"}`} />
                <Stat label="Jobs on" value={String(person.jobs.length)} />
                <Stat
                  label="Evaluations"
                  value={person.evaluations === 0 ? "None booked" : `${person.evaluations}, next ${day(person.nextEvaluation!)}`}
                />
                <Stat label="Clients managed" value={String(person.clients)} />
              </dl>
              {person.jobs.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  On: {person.jobs.slice(0, 6).map((j) => j.client).join(" · ")}
                  {person.jobs.length > 6 ? ` and ${person.jobs.length - 6} more` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
