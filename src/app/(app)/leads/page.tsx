import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getLeadEngine, type LeadEngineData } from "@/lib/data/leads";
import { TARGET_TICKET } from "@/lib/leads";
import { SetupRequiredNotice } from "@/components/setup-required-notice";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Who to chase next for a $5k+ landscaping job, and where those jobs come from.
 *
 * Everything here is drawn from work the business has already touched — no
 * bought list, no invented homeowners.
 */
export default async function LeadsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("leads", "/attractors");

  let data: LeadEngineData | null = null;
  try {
    data = await getLeadEngine();
  } catch (err) {
    console.error("Lead engine failed to load:", err);
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Leads</h1>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load leads. Try again in a moment.</p>
      </div>
    );
  }

  const qualified = data.leads.filter((l) => l.qualifies);
  const rest = data.leads.filter((l) => !l.qualifies);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Leads</h1>
      <p className="mb-4 text-muted-foreground">
        Homeowners already in the book who look worth {money(TARGET_TICKET)} or more — ranked by who to call
        first.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={`Worth ${money(TARGET_TICKET)}+`} value={String(qualified.length)} hint="Chase these" />
        <Tile label="Other leads" value={String(rest.length)} />
        <Tile label="Big jobs won" value={String(data.qualifiedWon)} hint={`At or above ${money(TARGET_TICKET)}`} />
        <Tile
          label="Average won job"
          value={data.averageWonTicket ? money(data.averageWonTicket) : "—"}
        />
      </div>

      {/* How the estimate was arrived at, stated rather than hidden. */}
      <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
        <h2 className="text-sm font-semibold">How the estimate works</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {data.calibration.sampleSize >= 5 ? (
            <>
              Calibrated on your own closed work: {data.calibration.sampleSize} jobs, working out at{" "}
              <strong>{money(data.calibration.perAcre)} per acre</strong> plus {money(data.calibration.base)} a job.
              A property with no quote yet is estimated from its lot size on that basis.
            </>
          ) : (
            <>
              Not enough closed jobs with a lot size recorded yet, so estimates use a starting assumption of{" "}
              {money(data.calibration.perAcre)} per acre plus {money(data.calibration.base)} a job. It recalibrates
              itself on your own numbers once five jobs have closed with both a total and a lot size — treat
              estimates loosely until then.
            </>
          )}
        </p>
      </section>

      <LeadList title={`Worth ${money(TARGET_TICKET)}+`} leads={qualified} emptyText="Nothing qualifying right now." />

      {/* Where to spend the marketing money */}
      <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-1 text-sm font-semibold">Where the big jobs come from</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Jobs won at {money(TARGET_TICKET)} or more, by how they reached you.
        </p>
        {data.sources.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing won yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.sources.map((s) => (
              <li key={s.source} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg border border-border p-2.5 text-sm">
                <span className="font-medium">{s.source}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {s.jobs} job{s.jobs === 1 ? "" : "s"} · {s.won} won · {s.bigJobs} big
                  {s.averageTicket ? ` · avg ${money(s.averageTicket)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-1 text-sm font-semibold">Best areas</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Where the work has actually paid — worth weighting door-hangers and ad radius towards.
        </p>
        {data.areas.length === 0 ? (
          <p className="text-xs text-muted-foreground">No jobs on the books yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.areas.slice(0, 8).map((a) => (
              <li key={a.area} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg border border-border p-2.5 text-sm">
                <span className="font-medium">{a.area}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {a.jobs} job{a.jobs === 1 ? "" : "s"} · {a.bigJobs} big
                  {a.averageTicket ? ` · avg ${money(a.averageTicket)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LeadList title="Everything else" leads={rest} emptyText="Nothing else on the list." />

      <p className="mt-4 text-xs text-muted-foreground">
        These are properties the business has already visited, quoted, or worked on. Nothing here is a bought
        list or a guessed homeowner — turning this into cold outreach would mean adding a data source, which is a
        separate decision.
      </p>
    </div>
  );
}

function LeadList({
  title,
  leads,
  emptyText,
}: {
  title: string;
  leads: LeadEngineData["leads"];
  emptyText: string;
}) {
  return (
    <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="mb-3 text-sm font-semibold">
        {title} ({leads.length})
      </h2>
      {leads.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {leads.slice(0, 40).map((lead) => (
            <li key={lead.jobId}>
              <Link
                href={`/jobs/${lead.jobId}`}
                className="block rounded-lg border border-border p-2.5 hover:bg-accent/50"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="font-medium">{lead.contactName}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {lead.ticket != null ? money(lead.ticket) : "—"}
                    {lead.ticketIsEstimate && (
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">est.</span>
                    )}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{lead.address}</p>
                <p className="mt-0.5 text-[11px] font-medium text-primary">{lead.reasonLabel}</p>
                {lead.why.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">{lead.why.join(" · ")}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
