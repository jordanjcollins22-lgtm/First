"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2, Mail, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/client-consent";
import { describeOffset, KIND_LABEL, KIND_WHY, type ReminderRule } from "@/lib/client-reminders";
import { describeWindow } from "@/lib/quiet-hours";
import { saveReminderRule, setClientRemindersEnabled, setQuietHours } from "@/lib/actions/reminder-actions";
import type { ReminderSettings } from "@/lib/data/reminder-settings";

/**
 * What clients hear from us automatically, and what stops it.
 *
 * One screen, because the switch and the evidence belong together. A master
 * switch on its own is something somebody flips and then has no way to find
 * out what it did; the counts under it are the answer to "is this thing on
 * and is it behaving".
 */
export function ReminderSettingsPanel({ settings }: { settings: ReminderSettings }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [rules, setRules] = useState(settings.rules);
  const [quiet, setQuiet] = useState({
    timeZone: settings.timeZone,
    startHour: settings.quietStart,
    endHour: settings.quietEnd,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nothingReady = !settings.smsReady && !settings.emailReady;

  function updateRule(kind: string, change: Partial<ReminderRule>) {
    const next = rules.map((rule) => (rule.kind === kind ? { ...rule, ...change } : rule));
    setRules(next);
    const saved = next.find((rule) => rule.kind === kind);
    if (!saved) return;
    setError(null);
    startTransition(async () => {
      const result = await saveReminderRule({
        kind: saved.kind,
        enabled: saved.enabled,
        channels: saved.channels,
        offsetsHours: saved.offsetsHours,
      });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Nothing can send, so say so before anything else on the page implies
          otherwise. A switch that is on and a provider that is missing is the
          exact combination that produces "we turned it on and nobody got
          anything". */}
      {nothingReady && (
        <Card className="border-amber-300/70 bg-amber-50/60">
          <CardContent className="flex gap-2 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
            <div>
              <p className="font-medium text-amber-900">Nothing can be sent yet.</p>
              <p className="text-amber-800">
                No text or email provider is connected. Reminders will be worked out and written down as
                skipped until one is.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Automated reminders to clients</h2>
              <p className="text-xs text-muted-foreground">
                Only about work in hand: appointments, proposals and invoices. Nothing here is ever sent to a
                list, and it cannot be, because it starts from the work rather than from the contacts.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={enabled ? "default" : "outline"}
              disabled={isPending}
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                setError(null);
                startTransition(async () => {
                  const result = await setClientRemindersEnabled(next);
                  if (!result.ok) {
                    setEnabled(!next);
                    setError(result.error);
                  }
                });
              }}
            >
              {isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {enabled ? "On" : "Off"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-4 border-t border-border/60 pt-3 text-xs">
            <Ready label="Text" ready={settings.smsReady} icon={<MessageSquare className="h-3 w-3" />} />
            <Ready label="Email" ready={settings.emailReady} icon={<Mail className="h-3 w-3" />} />
            <span className="text-muted-foreground">
              {settings.optedOut.sms} opted out of texts, {settings.optedOut.email} out of email
            </span>
            <span className="text-muted-foreground">
              Last 30 days: {settings.recent.sent} sent, {settings.recent.skipped} skipped,{" "}
              {settings.recent.failed} failed
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <div>
            <h2 className="text-sm font-semibold">Hours we may write to somebody</h2>
            <p className="text-xs text-muted-foreground">
              The client&apos;s clock, not ours. A reminder that comes due outside these hours waits for the
              morning rather than being dropped. Currently {describeWindow(quiet)}.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">From</span>
              <HourPicker
                value={quiet.startHour}
                onChange={(startHour) => setQuiet((q) => ({ ...q, startHour }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Until</span>
              <HourPicker value={quiet.endHour} onChange={(endHour) => setQuiet((q) => ({ ...q, endHour }))} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Time zone</span>
              <select
                value={quiet.timeZone}
                onChange={(e) => setQuiet((q) => ({ ...q, timeZone: e.target.value }))}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.split("/").pop()?.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await setQuietHours(quiet);
                  if (!result.ok) setError(result.error);
                });
              }}
            >
              <Check className="mr-1 h-3 w-3" /> Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-2">
        {rules.map((rule) => (
          <Card key={rule.kind}>
            <CardContent className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{KIND_LABEL[rule.kind]}</p>
                  <p className="text-xs text-muted-foreground">{KIND_WHY[rule.kind]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {rule.offsetsHours.map((hours) => describeOffset(hours)).join(", then ")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => updateRule(rule.kind, { enabled: !rule.enabled })}
                  className={cn(
                    "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium",
                    rule.enabled ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  )}
                >
                  {rule.enabled ? "On" : "Off"}
                </button>
              </div>
              <div className="flex gap-1.5">
                {(["sms", "email"] as Channel[]).map((channel) => {
                  const on = rule.channels.includes(channel);
                  const ready = channel === "sms" ? settings.smsReady : settings.emailReady;
                  return (
                    <button
                      key={channel}
                      type="button"
                      disabled={isPending}
                      title={ready ? undefined : "This channel is not connected yet"}
                      onClick={() =>
                        updateRule(rule.kind, {
                          channels: on
                            ? rule.channels.filter((c) => c !== channel)
                            : [...rule.channels, channel],
                        })
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                        on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
                        !ready && "opacity-60"
                      )}
                    >
                      {channel === "sms" ? <MessageSquare className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                      {channel === "sms" ? "Text" : "Email"}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Ready({ label, ready, icon }: { label: string; ready: boolean; icon: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1", ready ? "text-foreground" : "text-muted-foreground")}>
      {icon}
      {label}: {ready ? "connected" : "not connected"}
    </span>
  );
}

function HourPicker({ value, onChange }: { value: number; onChange: (hour: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-9 rounded-md border border-border bg-background px-2 text-sm"
    >
      {Array.from({ length: 25 }, (_, hour) => (
        <option key={hour} value={hour}>
          {hour === 0 || hour === 24 ? "12am" : hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`}
        </option>
      ))}
    </select>
  );
}

/** The zones a business in this country is actually in. */
const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];
