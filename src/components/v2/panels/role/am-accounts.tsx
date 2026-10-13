import { getCurrentProfile } from "@/lib/data/team";
import { loadAmAccounts } from "@/lib/data/am-home";
import { getCommissionFor } from "@/lib/data/commission";
import { outstandingFor } from "@/lib/am-home";
import { STATE_LABELS } from "@/lib/commission";
import { log } from "@/lib/log";
import { OpenEntityButton, OpenEntityName } from "@/components/v2/panels/sales/open-entity-button";
import { AmSection, CallLink, MessageReply } from "@/components/v2/panels/role/am-parts";

const SHOW = 15;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }) : "");

/**
 * Admin › Oversight, for the account manager: the client half of their day.
 * Answer what clients wrote, chase what they owe, look after the accounts
 * that are theirs and anything wrong on them, and see what they've earned.
 * Each name opens in the drawer for the rest.
 */
export async function AccountManagerAccountsPanel() {
  const viewer = await getCurrentProfile();
  if (!viewer) return <p className="text-sm text-muted-foreground">Sign in to see your accounts.</p>;
  const [accounts, commission] = await Promise.all([
    loadAmAccounts(viewer),
    getCommissionFor(viewer).catch((err) => {
      log.warn("am_home.commission_failed", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }),
  ]);
  const { messages, invoices, clients, issues } = accounts;
  const owed = invoices.reduce((s, i) => s + i.amount, 0);
  const lines = commission ? [...commission.lines].filter((l) => l.state !== "paid").sort((a, b) => b.amount - a.amount) : [];

  return (
    <div className="grid gap-5">
      <AmSection tour="am-messages" title="Client messages" count={messages.length} sub="Clients waiting on an answer, longest wait first. Write back, or tap Dealt with if you rang them.">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is waiting on you.</p>
        ) : (
          <ul className="grid gap-2">
            {messages.slice(0, SHOW).map((m) => (
              <li key={m.jobId} className="grid gap-2 rounded-xl border bg-background p-3">
                <div>
                  <OpenEntityName entity={{ kind: "sales.job", id: m.jobId }} name={m.customerName} className="font-semibold" />
                  <p className="text-sm text-muted-foreground">
                    {m.address} · {when(m.createdAt)}
                  </p>
                </div>
                <p className="whitespace-pre-line rounded-lg bg-muted px-3 py-2 text-sm">{m.body.slice(0, 500)}</p>
                <MessageReply jobId={m.jobId} />
              </li>
            ))}
            {messages.length > SHOW && <li className="text-sm text-muted-foreground">And {messages.length - SHOW} more after these.</li>}
          </ul>
        )}
      </AmSection>

      <AmSection tour="am-invoices" title="Invoices due" count={invoices.length} sub={invoices.length ? `${usd(owed)} not paid yet. Cash or check waiting to be picked up comes first.` : "Unpaid invoices on your clients."}>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything is paid.</p>
        ) : (
          <ul className="grid gap-2">
            {invoices.slice(0, SHOW).map((i) => (
              <li key={i.invoiceId} className="flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {i.customerName} <span className="font-mono text-sm font-normal">{usd(i.amount)}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{i.payBy ? `Paying by ${i.payBy}: go and collect it` : outstandingFor(i)}</p>
                </div>
                <OpenEntityButton entity={{ kind: "sales.invoice", id: i.invoiceId }} label={i.payBy ? "Record it paid" : "Open"} />
              </li>
            ))}
            {invoices.length > SHOW && <li className="text-sm text-muted-foreground">And {invoices.length - SHOW} more after these.</li>}
          </ul>
        )}
      </AmSection>

      <AmSection tour="am-clients" title="My clients" count={clients.length} sub="The accounts you look after. Anything wrong on a job comes first.">
        {issues.length > 0 && (
          <ul className="grid gap-2">
            {issues.slice(0, SHOW).map((i) => (
              <li key={i.id} className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 sm:flex-row sm:items-center dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{i.title}</p>
                  <p className="text-sm opacity-80">
                    {i.customerName} · raised {day(i.createdAt)}
                    {i.severity && i.severity !== "info" ? ` · ${i.severity}` : ""}
                  </p>
                </div>
                <OpenEntityButton entity={{ kind: "ops.issue", id: i.id }} label="Deal with it" />
              </li>
            ))}
          </ul>
        )}
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clients are assigned to you yet. The owner assigns them, or ringing a client about their proposal makes them yours.</p>
        ) : (
          <ul className="grid gap-1.5">
            {clients.slice(0, 50).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-1.5">
                <span>
                  <OpenEntityName entity={{ kind: "sales.client", id: c.id }} name={c.name} className="font-medium" />
                  {c.openIssues > 0 && <span className="ml-2 text-sm text-amber-700 dark:text-amber-300">{c.openIssues} open</span>}
                </span>
                <CallLink phone={c.phone} />
              </li>
            ))}
            {clients.length > 50 && <li className="text-sm text-muted-foreground">And {clients.length - 50} more.</li>}
          </ul>
        )}
      </AmSection>

      <AmSection tour="am-commission" title="My commission" sub="What you've earned on the clients you manage. Payable is ready; coming is on work still running.">
        {!commission ? (
          <p className="text-sm text-muted-foreground">Your commission couldn&apos;t load just now.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Payable", commission.earned],
                ["Coming", commission.accruing + commission.held],
                ["Paid", commission.paid],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl border bg-background p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="font-mono text-xl">{usd(value as number)}</p>
                </div>
              ))}
            </div>
            {lines.length > 0 && (
              <ul className="grid gap-1.5">
                {lines.slice(0, 10).map((l) => (
                  <li key={l.jobId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-sm">
                    <OpenEntityName entity={{ kind: "sales.job", id: l.jobId }} name={l.customerName || l.address} className="font-medium" />
                    <span>
                      <span className="font-mono">{usd(l.amount)}</span> · {STATE_LABELS[l.state]}
                      {l.reason ? <span className="text-muted-foreground"> · {l.reason}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </AmSection>
    </div>
  );
}
