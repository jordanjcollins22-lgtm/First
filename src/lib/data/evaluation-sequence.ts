import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { isSequenceStep, type SequenceStep } from "@/lib/evaluation-sequence";

/** The evaluation email sequence as this business will send it, with the evidence. */
export interface EvaluationSequenceView {
  steps: SequenceStep[];
  timeZone: string;
  /** What actually went out lately. A switch with no evidence is a rumour. */
  recent: { sent: number; failed: number; lastSentAt: string | null };
}

export async function getEvaluationSequence(): Promise<EvaluationSequenceView> {
  const supabase = await createClient();
  const organization = await getCurrentOrganization();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: rows, error }, { data: log }] = await Promise.all([
    supabase.rpc("evaluation_sequence_effective"),
    supabase
      .from("client_message_log")
      .select("status, created_at")
      .eq("channel", "email")
      .like("kind", "evaluation_%")
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw error;

  const steps: SequenceStep[] = (rows ?? [])
    .filter((row) => isSequenceStep(row.step))
    .map((row) => ({
      step: row.step as SequenceStep["step"],
      ordinal: row.ordinal,
      label: row.label,
      timing: row.timing,
      enabled: row.enabled,
      subject: row.subject,
      body: row.body,
      custom: row.custom,
      updatedAt: row.updated_at,
    }));

  const sentRows = (log ?? []).filter((row) => row.status === "sent");
  return {
    steps,
    timeZone: organization.reminder_time_zone ?? "America/New_York",
    recent: {
      sent: sentRows.length,
      failed: (log ?? []).filter((row) => row.status === "failed").length,
      lastSentAt: sentRows[0]?.created_at ?? null,
    },
  };
}
