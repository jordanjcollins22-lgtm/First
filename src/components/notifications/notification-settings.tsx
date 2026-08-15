"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  saveMyPhone,
  saveNotificationPreferences,
  type NotificationPreferencesInput,
} from "@/lib/actions/notification-actions";
import { cn } from "@/lib/utils";
import type { NotificationPreferences } from "@/types/domain";

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
        checked ? "border-primary/40 bg-primary/5" : "border-border hover:bg-accent/40",
        disabled && "opacity-50"
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

export function NotificationSettings({
  preferences,
  phone,
  smsConfigured,
}: {
  preferences: NotificationPreferences | null;
  phone: string | null;
  /** Twilio isn't set up on the server — texts won't actually send. */
  smsConfigured: boolean;
}) {
  const [phoneValue, setPhoneValue] = useState(phone ?? "");
  const [savedPhone, setSavedPhone] = useState(phone ?? "");
  const [form, setForm] = useState<NotificationPreferencesInput>({
    smsEnabled: preferences?.sms_enabled ?? false,
    appointmentReminders: preferences?.appointment_reminders ?? true,
    clientMessages: preferences?.client_messages ?? true,
    proposalResponses: preferences?.proposal_responses ?? true,
    teamMessages: preferences?.team_messages ?? false,
    reminderHoursBefore: preferences?.reminder_hours_before ?? 24,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function update(patch: Partial<NotificationPreferencesInput>) {
    const next = { ...form, ...patch };
    setForm(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveNotificationPreferences(next);
      if (!result.ok) {
        setForm(form);
        setError(result.message);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  function handleSavePhone() {
    setError(null);
    startTransition(async () => {
      const result = await saveMyPhone(phoneValue);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSavedPhone(phoneValue.trim());
    });
  }

  const phoneDirty = phoneValue.trim() !== savedPhone.trim();

  return (
    <div className="flex flex-col gap-4">
      {!smsConfigured && (
        <Card className="border-amber-400/40 bg-amber-400/5">
          <CardContent className="pt-6 text-sm">
            Texting isn&apos;t set up on the server yet, so nothing will actually send. Your choices here are
            saved and take effect as soon as it is.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notify-phone">Your mobile number</Label>
            <div className="flex gap-2">
              <Input
                id="notify-phone"
                type="tel"
                value={phoneValue}
                onChange={(e) => setPhoneValue(e.target.value)}
                placeholder="(555) 123-4567"
                className="w-48"
              />
              <Button type="button" variant="outline" onClick={handleSavePhone} disabled={isPending || !phoneDirty}>
                {phoneDirty ? "Save number" : "Saved"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Texts go here. Leave blank to stop all texts.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <Toggle
            label="Text me notifications"
            hint="The master switch — everything below is off until this is on."
            checked={form.smsEnabled}
            onChange={(next) => update({ smsEnabled: next })}
            disabled={isPending}
          />

          <div className="flex flex-col gap-2 pl-1">
            <Toggle
              label="Appointment reminders"
              hint="A heads-up before an evaluation you're assigned to."
              checked={form.appointmentReminders}
              onChange={(next) => update({ appointmentReminders: next })}
              disabled={isPending || !form.smsEnabled}
            />
            <Toggle
              label="Client messages"
              hint="When a client texts or messages back about a job you're on."
              checked={form.clientMessages}
              onChange={(next) => update({ clientMessages: next })}
              disabled={isPending || !form.smsEnabled}
            />
            <Toggle
              label="Proposal responses"
              hint="When a client accepts or declines a proposal."
              checked={form.proposalResponses}
              onChange={(next) => update({ proposalResponses: next })}
              disabled={isPending || !form.smsEnabled}
            />
            <Toggle
              label="Team group messages"
              hint="When someone posts in a group you're in. Off by default — these can be chatty."
              checked={form.teamMessages}
              onChange={(next) => update({ teamMessages: next })}
              disabled={isPending || !form.smsEnabled}
            />
          </div>

          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            How far ahead a reminder goes out is set on the calendar itself, under Calendar settings — so each
            calendar can have its own lead time.
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {saved && <p className="text-xs text-primary">Saved.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
