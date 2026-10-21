import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listRecentCheckIns } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import type { CheckInStatus, ReplyAssessment } from "@/types/domain";

const STATUS: Record<CheckInStatus, { label: string; variant: BadgeProps["variant"] }> = {
  pending: { label: "Queued", variant: "outline" },
  sent: { label: "Waiting on reply", variant: "outline" },
  responded: { label: "Replied on time", variant: "default" },
  late: { label: "Replied late", variant: "secondary" },
  missed: { label: "Missed", variant: "destructive" },
  failed: { label: "Send failed", variant: "destructive" },
};

const ASSESSMENT: Record<ReplyAssessment, { label: string; variant: BadgeProps["variant"] }> = {
  on_track: { label: "On track", variant: "default" },
  delayed: { label: "Delayed", variant: "secondary" },
  blocked: { label: "Blocked", variant: "destructive" },
  unclear: { label: "Unclear", variant: "outline" },
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

export default async function CheckInsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const checkIns = await listRecentCheckIns();
  const needsAttention = checkIns.filter(
    (c) =>
      c.status === "missed" ||
      c.status === "failed" ||
      c.reply_assessment === "delayed" ||
      c.reply_assessment === "blocked"
  ).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Check-ins</h1>
      <p className="mb-6 text-muted-foreground">
        {needsAttention > 0
          ? `${needsAttention} recent check-in${needsAttention === 1 ? "" : "s"} need attention.`
          : "Everyone's on track."}{" "}
        Missed check-ins and replies that report a delay or blocker are also texted to managers.
      </p>

      {checkIns.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No check-ins yet. Schedule some on the Team page.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {checkIns.map((c) => {
          const status = STATUS[c.status];
          const assessment = c.reply_assessment ? ASSESSMENT[c.reply_assessment] : null;
          return (
            <Card key={c.id}>
              <CardContent className="flex flex-col gap-2 pt-6 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {c.team_member?.name ?? "Former team member"}
                    {c.job && <span className="font-normal text-muted-foreground"> · {c.job.name}</span>}
                  </p>
                  <div className="flex gap-1.5">
                    {assessment && <Badge variant={assessment.variant}>{assessment.label}</Badge>}
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  {formatWhen(c.scheduled_for)}: &ldquo;{c.message}&rdquo;
                </p>
                {c.response_text && (
                  <p>
                    <span className="font-medium">Reply</span>
                    {c.responded_at && (
                      <span className="text-muted-foreground"> ({formatWhen(c.responded_at)})</span>
                    )}
                    : {c.response_text}
                  </p>
                )}
                {c.reply_summary && <p className="text-muted-foreground">Claude: {c.reply_summary}</p>}
                {c.error && <p className="text-destructive">{c.error}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
