import { getCurrentProfile } from "@/lib/data/team";
import { loadAmSales } from "@/lib/data/am-home";
import { getCallList } from "@/lib/data/call-list";
import { log } from "@/lib/log";
import { CallListPanel } from "@/components/sales/call-list";
import { OpenEntityButton } from "@/components/v2/panels/sales/open-entity-button";
import { AmSection, CallLink } from "@/components/v2/panels/role/am-parts";

/** How many of a list the home screen shows before "and N more". */
const SHOW = 15;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }) : "");

/**
 * Sales › Pipeline, for the account manager: the sales half of their day,
 * in the order it gets done. Ring the new leads and book their visit; price
 * and approve what the evaluators wrote up; then follow up the proposals
 * the clients haven't answered. Every row opens in the drawer, where the
 * booking, the approving and the rest happen.
 */
export async function AccountManagerSalesPanel() {
  const viewer = await getCurrentProfile();
  if (!viewer) return <p className="text-sm text-muted-foreground">Sign in to see your day.</p>;
  const [sales, calls] = await Promise.all([
    loadAmSales(viewer),
    getCallList(viewer).catch((err) => {
      log.warn("am_home.call_list_failed", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }),
  ]);
  const firstName = (viewer.first_name || viewer.full_name || "").split(" ")[0] || "us";

  return (
    <div className="grid gap-5">
      <AmSection tour="am-book" title="Call and book a visit" count={sales.leads.length} sub="New leads first: ring them, then tap Book to pick the evaluator and the time.">
        {sales.leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody waiting. New leads land here the moment they come in.</p>
        ) : (
          <ul className="grid gap-2">
            {sales.leads.slice(0, SHOW).map((l) => (
              <li key={l.jobId} className="flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{l.customerName}</p>
                  <p className="truncate text-sm text-muted-foreground">{l.address}</p>
                  <p className={"text-sm " + (l.reason === "new" ? "font-medium text-primary" : "text-amber-700 dark:text-amber-300")}>{l.why}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CallLink phone={l.phone} />
                  <OpenEntityButton entity={{ kind: "sales.evaluation", id: l.jobId }} label={l.reason === "new" ? "Book" : "Rebook"} />
                </div>
              </li>
            ))}
            {sales.leads.length > SHOW && <li className="text-sm text-muted-foreground">And {sales.leads.length - SHOW} more after these.</li>}
          </ul>
        )}
      </AmSection>

      <AmSection tour="am-approve" title="Price and approve" count={sales.toApprove.length} sub="Proposals the evaluators wrote up. Open one, check the price, approve it or change it, then send it.">
        {sales.toApprove.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing waiting on a price.</p>
        ) : (
          <ul className="grid gap-2">
            {sales.toApprove.slice(0, SHOW).map((p) => (
              <li key={p.proposalId} className="flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {p.customerName} <span className="font-mono text-sm font-normal">{usd(p.total)}</span>
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.address} · written {day(p.writtenAt)}
                  </p>
                </div>
                <OpenEntityButton entity={{ kind: "sales.proposal", id: p.proposalId }} label="Check and approve" />
              </li>
            ))}
            {sales.toApprove.length > SHOW && <li className="text-sm text-muted-foreground">And {sales.toApprove.length - SHOW} more after these.</li>}
          </ul>
        )}
      </AmSection>

      <div data-tour="am-follow-up">
        {calls ? (
          <CallListPanel list={calls} callerFirstName={firstName} />
        ) : (
          <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">Your follow-up calls couldn&apos;t load just now. Try again in a minute.</p>
        )}
      </div>
    </div>
  );
}
