import { DraftCard } from "@/components/inbox/draft-card";
import { CHANNEL_LABEL } from "@/components/inbox/channels";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listPendingDrafts, listRecentRuns } from "@/lib/data/inbox";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";

const SENDER: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  manager: { label: "Manager", variant: "default" },
  team: { label: "Employee", variant: "secondary" },
  customer: { label: "Customer", variant: "outline" },
  unknown: { label: "New contact", variant: "outline" },
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function InboxPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const [drafts, runs] = await Promise.all([listPendingDrafts(), listRecentRuns()]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Inbox</h1>
      <p className="mb-6 text-muted-foreground">
        Every text, email and DM goes to the assistant first.{" "}
        {serverEnv.agentCustomerMode === "auto"
          ? "It answers routine customer messages itself and holds anything sensitive for you here."
          : "Its replies to customers wait here for you to approve. Managers can also approve by texting back."}
      </p>

      <h2 className="mb-3 text-lg font-semibold">
        Waiting for approval{drafts.length > 0 && ` (${drafts.length})`}
      </h2>
      {drafts.length === 0 ? (
        <p className="mb-8 text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <div className="mb-8 flex flex-col gap-3">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Recent activity</h2>
      {runs.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      <div className="flex flex-col gap-3">
        {runs.map((run) => {
          const inbound = run.messages.find((m) => m.direction === "inbound");
          const sender = SENDER[run.sender_kind] ?? SENDER.unknown;
          const name = run.team_member?.name ?? inbound?.contact_name ?? inbound?.contact_address ?? "Unknown";
          return (
            <Card key={run.id}>
              <CardContent className="flex flex-col gap-2 pt-6 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {name}
                    <span className="font-normal text-muted-foreground"> · {formatWhen(run.created_at)}</span>
                  </p>
                  <div className="flex gap-1.5">
                    <Badge variant="outline">{CHANNEL_LABEL[run.channel] ?? run.channel}</Badge>
                    <Badge variant={sender.variant}>{sender.label}</Badge>
                    {run.status === "error" && <Badge variant="destructive">Error</Badge>}
                    {run.status === "running" && <Badge variant="outline">Working</Badge>}
                  </div>
                </div>
                {inbound && <p>&ldquo;{inbound.body}&rdquo;</p>}
                {run.summary && <p className="text-muted-foreground">Assistant: {run.summary}</p>}
                {run.error && <p className="text-destructive">{run.error}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
