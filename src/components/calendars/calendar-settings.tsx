"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Plus, Settings as SettingsIcon, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createCalendar,
  deleteCalendar,
  setCalendarMember,
  updateCalendar,
} from "@/lib/actions/calendar-actions";
import type { CalendarWithMembers } from "@/types/domain";

interface TeamMember {
  id: string;
  name: string;
}

function NewCalendarForm() {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2f6d3c");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const result = await createCalendar(name, color, description);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setName("");
      setColor("#2f6d3c");
      setDescription("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="calendar-name">Name</Label>
          <Input
            id="calendar-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Evaluations"
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="calendar-color">Color</Label>
          <Input
            id="calendar-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-11 w-20 p-1"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="calendar-description">Description</Label>
          <Input
            id="calendar-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What goes on this calendar"
            className="w-72"
          />
        </div>
        <Button type="button" onClick={handleAdd} disabled={isPending || !name.trim()}>
          <Plus className="h-4 w-4" />
          {isPending ? "Adding..." : "Add calendar"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function CalendarCard({ calendar, teamMembers }: { calendar: CalendarWithMembers; teamMembers: TeamMember[] }) {
  const [name, setName] = useState(calendar.name);
  const [color, setColor] = useState(calendar.color);
  const [description, setDescription] = useState(calendar.description ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(calendar.memberIds);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateCalendar(calendar.id, { name, color, description });
      if (!result.ok) setError(result.message);
    });
  }

  function toggleMember(profileId: string) {
    const nextIsMember = !memberIds.includes(profileId);
    // Flip locally first so the checkbox responds immediately; put it back if
    // the save fails.
    setMemberIds((prev) => (nextIsMember ? [...prev, profileId] : prev.filter((id) => id !== profileId)));
    setError(null);
    startTransition(async () => {
      const result = await setCalendarMember(calendar.id, profileId, nextIsMember);
      if (!result.ok) {
        setMemberIds((prev) => (nextIsMember ? prev.filter((id) => id !== profileId) : [...prev, profileId]));
        setError(result.message);
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCalendar(calendar.id);
      if (!result.ok) {
        setError(result.message);
        setConfirmingDelete(false);
      }
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={save}
              disabled={isPending}
              className="h-9 w-56 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Color</Label>
            <Input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              onBlur={save}
              disabled={isPending}
              className="h-9 w-16 p-1"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={save}
              disabled={isPending}
              rows={1}
              className="text-sm"
            />
          </div>
          {calendar.is_system ? (
            <span className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">
              Built in
            </span>
          ) : confirmingDelete ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
                Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            Who&apos;s on it ({memberIds.length} of {teamMembers.length})
          </span>
          {teamMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {teamMembers.map((member) => {
                const isMember = memberIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    disabled={isPending}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      isMember
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card/60 hover:bg-accent"
                    }`}
                  >
                    {member.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** Lives inside the Calendar page, collapsed by default so it stays out of
 * the way of the schedule itself. Admin-only — the page decides that. */
export function CalendarSettings({
  calendars,
  teamMembers,
}: {
  calendars: CalendarWithMembers[];
  teamMembers: TeamMember[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-8 border-t border-border pt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary"
        aria-expanded={open}
      >
        <SettingsIcon className="h-4 w-4" />
        Calendar settings
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && <CalendarSettingsBody calendars={calendars} teamMembers={teamMembers} />}
    </div>
  );
}

function CalendarSettingsBody({
  calendars,
  teamMembers,
}: {
  calendars: CalendarWithMembers[];
  teamMembers: TeamMember[];
}) {
  return (
    <div className="mt-4 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <NewCalendarForm />
        </CardContent>
      </Card>

      {calendars.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No calendars yet — add one above, then tap team members to assign them to it.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {calendars.map((calendar) => (
            <CalendarCard key={calendar.id} calendar={calendar} teamMembers={teamMembers} />
          ))}
        </div>
      )}
    </div>
  );
}
