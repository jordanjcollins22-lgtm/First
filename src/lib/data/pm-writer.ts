import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isAnthropicConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { seasonFor, stepSchedule } from "@/lib/pm-outreach";
import { DEFAULT_OFFER, DEFAULT_STORY, SequenceSchema, companyBrief, sequenceProblems, writerSystemPrompt, type Sequence } from "@/lib/pm-writer-prompt";

type Admin = ReturnType<typeof createAdminClient>;

export interface WriterSettings {
  story: string | null;
  offer: string | null;
  fromName: string | null;
  autoApprove: boolean;
}

/**
 * Write the three emails for each company that has an address to write to
 * and nothing written yet. A few a run. They wait for a person to read them,
 * unless the owner has said new ones may go straight out.
 */
export async function writeSequences(
  admin: Admin,
  organizationId: string,
  settings: WriterSettings,
  org: { name: string; phone: string | null },
  now: Date,
  limit = 4
): Promise<number> {
  if (!isAnthropicConfigured) return 0;
  const { data: rows } = await admin
    .from("pm_companies")
    .select("id, name, address, website, contact_name")
    .eq("organization_id", organizationId)
    .eq("status", "ready")
    .order("created_at")
    .limit(limit);
  let written = 0;
  for (const row of rows ?? []) {
    const sequence = await writeOne(
      { name: row.name, address: row.address, website: row.website, contactName: row.contact_name },
      { businessName: org.name, sender: (settings.fromName || "Jordan").split(/\s+/)[0], phone: org.phone, story: settings.story || DEFAULT_STORY, offer: settings.offer || DEFAULT_OFFER, season: seasonFor(now) }
    );
    if (!sequence) {
      await admin.from("pm_companies").update({ last_error: "Couldn't write emails for this one. Try again.", updated_at: now.toISOString() }).eq("id", row.id);
      continue;
    }
    await saveSequence(admin, organizationId, row.id, sequence, settings.autoApprove, now);
    written += 1;
  }
  return written;
}

/** The emails saved for a company, scheduled at once when nobody needs to read them first. */
export async function saveSequence(admin: Admin, organizationId: string, companyId: string, sequence: Sequence, approve: boolean, now: Date): Promise<void> {
  const when = stepSchedule(now, companyId);
  await admin.from("pm_emails").delete().eq("company_id", companyId).in("status", ["draft", "scheduled"]);
  await admin.from("pm_emails").insert(
    sequence.emails
      .slice()
      .sort((a, b) => a.step - b.step)
      .map((email, i) => ({
        organization_id: organizationId,
        company_id: companyId,
        step: email.step,
        subject: email.subject.trim().slice(0, 140),
        body: email.body.trim(),
        status: approve ? "scheduled" : "draft",
        send_after: approve ? when[i]?.toISOString() ?? null : null,
      }))
  );
  await admin
    .from("pm_companies")
    .update({ status: approve ? "approved" : "drafted", last_error: null, updated_at: now.toISOString() })
    .eq("id", companyId);
}

async function writeOne(company: Parameters<typeof companyBrief>[0], brief: Parameters<typeof writerSystemPrompt>[0]): Promise<Sequence | null> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.beta.messages.parse({
        model: "claude-opus-5",
        max_tokens: 6000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: betaZodOutputFormat(SequenceSchema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: writerSystemPrompt(brief),
        messages: [{ role: "user", content: companyBrief(company) }],
      });
      const sequence = response.parsed_output ?? null;
      if (!sequence) continue;
      const problems = sequenceProblems(sequence);
      if (problems.length === 0) return sequence;
      log.warn("pm.sequence_refused", { problems });
    } catch (err) {
      log.warn("pm.write_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return null;
}
