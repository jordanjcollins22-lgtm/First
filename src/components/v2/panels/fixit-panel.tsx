import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { firstLine, STATUS_WORD, type BuildStatus, type TicketStatus } from "@/lib/fixit/messages";
import { discordConfigForOrg, latestBuild, listOpenTickets, screenshotLinks, type FixitBuild, type FixitTicket } from "@/lib/fixit/store";
import { ApproveBuildButton, RegisterCommandsButton, SendBackForm } from "@/components/v2/panels/fixit-controls";

/**
 * Admin › Settings › Fix-it tickets: what the owner reported from Discord
 * with /fixit, and the latest build of them. Approve and Send back here do
 * the same as /approve and /sendback in the channel. Screenshots show
 * through ten-minute links; the bucket itself is private.
 */

const TICKET_CHIP: Record<TicketStatus, string> = {
  open: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  building: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  fixed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  question: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  sent_back: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  closed: "bg-muted text-muted-foreground",
};
const BUILD_WORD: Record<BuildStatus, string> = { queued: "Queued", running: "Running", ready: "Ready to check", approved: "Approved", failed: "Failed" };

async function load(): Promise<{ tickets: FixitTicket[]; build: FixitBuild | null; links: Map<string, string>; connected: boolean } | null> {
  const organizationId = await getCurrentOrganizationId();
  try {
    const [tickets, build, config] = await Promise.all([listOpenTickets(organizationId), latestBuild(organizationId), discordConfigForOrg(organizationId)]);
    const links = await screenshotLinks(tickets.flatMap((t) => (t.screenshot_path ? [t.screenshot_path] : []))).catch(() => new Map<string, string>());
    return { tickets, build, links, connected: Boolean(config?.botToken) };
  } catch {
    return null;
  }
}

export async function FixitPanel() {
  const data = await load();
  if (!data)
    return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Fix-it tickets need migration 0368_fixit_tickets.sql applied before they can be used.</p>;
  const { tickets, build, links, connected } = data;

  return (
    <section className="space-y-5" aria-labelledby="fixit-heading">
      <header className="space-y-1">
        <h2 id="fixit-heading" className="text-xl font-bold">
          Fix-it tickets
        </h2>
        <p className="text-sm text-muted-foreground">
          Type <code>/fixit</code> in your Discord channel with a screenshot to add one, <code>/build</code> to have them all fixed, then check the preview and approve it here or with <code>/approve</code>.
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-3 rounded-xl border bg-card p-3 text-sm">
        <span className="min-w-0 flex-1 text-muted-foreground">
          {connected ? "Discord is connected." : "Connect Discord under Integrations first (Admin › Settings › Integrations › Discord)."} Press this once after connecting, and again if the commands go missing.
        </span>
        <RegisterCommandsButton />
      </div>

      {build && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Build #{build.number}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{BUILD_WORD[build.status]}</span>
            {build.branch && <code className="text-xs text-muted-foreground">{build.branch}</code>}
          </div>
          {build.summary && <p className="whitespace-pre-wrap text-sm">{build.summary}</p>}
          {build.preview_url && (
            <a href={build.preview_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline">
              Open the preview
            </a>
          )}
          {build.status === "ready" && <ApproveBuildButton number={build.number} />}
        </div>
      )}

      {tickets.length === 0 ? (
        <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">No open tickets.</p>
      ) : (
        <ul className="space-y-2" aria-label="Open tickets">
          {tickets.map((t) => {
            const shot = t.screenshot_path ? links.get(t.screenshot_path) : undefined;
            return (
              <li key={t.id} className="flex flex-wrap items-start gap-3 rounded-xl border bg-card p-3 text-sm">
                {shot ? (
                  <a href={shot} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot} alt={`Screenshot for ticket #${t.number}`} className="h-16 w-24 rounded-md border object-cover" />
                  </a>
                ) : (
                  <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md border text-xs text-muted-foreground">No image</span>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>#{t.number}</b>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TICKET_CHIP[t.status]}`}>{STATUS_WORD[t.status]}</span>
                  </div>
                  <p className="break-words">{firstLine(t.description, 200)}</p>
                  {t.result && <p className="text-xs text-muted-foreground">Result: {t.result}</p>}
                  {t.owner_note && <p className="text-xs text-muted-foreground">Your note: {t.owner_note}</p>}
                </div>
                <SendBackForm number={t.number} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
