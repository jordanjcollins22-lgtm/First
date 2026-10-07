"use client";

import { useState, useTransition } from "react";
import { MessageSquare, Plus, Trash2, UserMinus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  deactivateTeamMember,
  deleteCheckInSchedule,
  sendCheckInNow,
} from "@/lib/actions/team-actions";
import { formatPhoneForDisplay } from "@/lib/check-ins/phone";
import type { TeamMemberWithSchedules } from "@/lib/data/team";

import { AddScheduleForm } from "./add-schedule-form";
import { DAY_LABELS, TIMEZONES } from "./constants";

function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function formatDays(days: number[]) {
  const sorted = [...days].sort();
  if (sorted.join() === "1,2,3,4,5") return "Weekdays";
  if (sorted.length === 7) return "Every day";
  return sorted.map((d) => DAY_LABELS[d]).join(", ");
}

export function TeamMemberCard({
  member,
  jobs,
}: {
  member: TeamMemberWithSchedules;
  jobs: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const tzLabel = TIMEZONES.find((t) => t.value === member.timezone)?.label ?? member.timezone;

  function textNow() {
    startTransition(async () => {
      const result = await sendCheckInNow(member.id);
      setNotice(result.error ? `Couldn't send: ${result.error}` : "Check-in sent.");
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{member.name}</p>
            <p className="text-sm text-muted-foreground">
              {formatPhoneForDisplay(member.phone)} · {tzLabel} time
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {member.role && <Badge variant="outline">{member.role}</Badge>}
              {member.is_manager && <Badge>Manager</Badge>}
              <Badge variant={member.ghl_contact_id ? "secondary" : "outline"}>
                {member.ghl_contact_id ? "Linked in GoHighLevel" : "Not linked to GHL yet"}
              </Badge>
            </div>
          </div>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={textNow}>
              <MessageSquare className="mr-1.5 h-4 w-4" />
              {isPending ? "Sending..." : "Check in now"}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title="Remove from team"
              disabled={isPending}
              onClick={() => {
                if (confirm(`Remove ${member.name}? Their scheduled check-ins will stop.`)) {
                  startTransition(() => deactivateTeamMember(member.id));
                }
              }}
            >
              <UserMinus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

        <div className="flex flex-col gap-2">
          {member.schedules.length === 0 && !adding && (
            <p className="text-sm text-muted-foreground">No scheduled check-ins yet.</p>
          )}
          {member.schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">
                  {s.label} · {formatDays(s.days_of_week)} at {formatTime(s.time_of_day)}
                  {s.job && <span className="text-muted-foreground"> · {s.job.name}</span>}
                </p>
                <p className="text-muted-foreground">
                  &ldquo;{s.message}&rdquo; · reply within {s.response_window_minutes} min
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Delete check-in"
                onClick={() => startTransition(() => deleteCheckInSchedule(s.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          {adding ? (
            <AddScheduleForm teamMemberId={member.id} jobs={jobs} onDone={() => setAdding(false)} />
          ) : (
            <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add scheduled check-in
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
