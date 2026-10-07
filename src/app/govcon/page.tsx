import { connection } from "next/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpportunityTable } from "@/components/govcon/opportunity-table";
import { RunButtons } from "@/components/govcon/run-buttons";
import { getDashboard, isGovconDbConfigured } from "@/lib/data/govcon";

export const maxDuration = 300; // "run now" server actions

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default async function GovconDashboard() {
  await connection();
  if (!isGovconDbConfigured()) {
    return (
      <p className="text-muted-foreground">
        Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code>, then run{" "}
        <code>supabase/migrations/0003_govcon.sql</code>. See <code>docs/govcon/README.md</code>.
      </p>
    );
  }
  const d = await getDashboard();
  const lastRun = d.runs[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bid pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Finds solicitations, lines up local subs, collects quotes, prices and drafts the bid. You review and submit.
            {lastRun && ` Last run: ${lastRun.stage} ${new Date(lastRun.started_at).toLocaleString()} ${lastRun.ok === false ? "(failed)" : ""}`}
          </p>
        </div>
        <RunButtons />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Submitted this month" value={`${d.submittedThisMonth} / ${d.profile.monthlyProposalTarget}`} sub="Win rate is ~5–10%: volume wins" />
        <Stat label="Ready to submit" value={d.ready.length} />
        <Stat label="Collecting quotes" value={d.inFlight.length} />
        <Stat label="Subs to call" value={d.callList} />
        <Stat label="Won" value={d.won} />
      </div>

      <Card>
        <CardHeader><CardTitle>Ready for your review</CardTitle></CardHeader>
        <CardContent><OpportunityTable rows={d.ready} empty="Nothing ready yet — bids appear here once sub quotes are in and priced." /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Collecting sub quotes</CardTitle></CardHeader>
        <CardContent><OpportunityTable rows={d.inFlight} empty="No RFQs out right now." /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>New matches (queued for document review)</CardTitle></CardHeader>
        <CardContent><OpportunityTable rows={d.fresh} empty="No new matches — run discovery or wait for tomorrow's SAM.gov file." /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Submitted & decided</CardTitle></CardHeader>
        <CardContent><OpportunityTable rows={d.submitted} empty="No submissions yet." /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>What the system did</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {d.events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-36 shrink-0 text-xs text-muted-foreground tabular-nums">{new Date(e.created_at).toLocaleString()}</span>
                <span className={e.kind === "error" ? "text-destructive" : ""}>{e.message}</span>
              </li>
            ))}
            {!d.events.length && <li className="text-muted-foreground">No activity yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
