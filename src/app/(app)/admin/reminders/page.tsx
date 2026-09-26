import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getReminderSettings } from "@/lib/data/reminder-settings";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ReminderSettingsPanel } from "@/components/messaging/reminder-settings-panel";
import { EvaluationSequencePanel } from "@/components/messaging/evaluation-sequence-panel";
import { getEvaluationSequence } from "@/lib/data/evaluation-sequence";
import { listPendingApprovals } from "@/lib/data/outbound-approvals";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsPanel } from "@/components/messaging/approvals-panel";
import { ApprovalSwitch } from "@/components/messaging/approval-switch";

/**
 * What clients hear from us without anybody typing it.
 *
 * The switch, the hours, and each reminder, on one screen with the evidence
 * of what it has actually been doing. A switch with no evidence under it is a
 * rumour.
 */
export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("reminders", "/admin/tools");

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const [settings, sequence, pending, { data: org }] = await Promise.all([
    getReminderSettings().catch(() => null),
    getEvaluationSequence().catch(() => null),
    listPendingApprovals().catch(() => []),
    supabase.from("organizations").select("require_email_approval").eq("id", organizationId).maybeSingle(),
  ]);
  if (!settings) redirect("/admin/tools");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Client Reminders</h1>
        <p className="text-sm text-muted-foreground">
          Appointment reminders, proposal follow-ups and invoice reminders, sent on their own. Everything here
          is about work a client has in hand. Anyone who replies STOP to a text, or uses the unsubscribe link
          in an email, is taken off straight away and stays off.
        </p>
      </header>
      <ApprovalSwitch required={Boolean(org?.require_email_approval)} />
      <ApprovalsPanel items={pending} />
      {sequence && <EvaluationSequencePanel view={sequence} />}
      <ReminderSettingsPanel settings={settings} />
    </div>
  );
}
