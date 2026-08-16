/**
 * What the Conversations assistant is allowed to do to client accounts.
 *
 * Every tool runs with the signed-in user's Supabase client, so RLS applies
 * exactly as it would if they'd clicked the buttons themselves — the assistant
 * can never reach an account the person couldn't already open. Tools return
 * plain objects (never throw) so a failure comes back to the model as text it
 * can explain, rather than a 500 the person sees as a crash.
 *
 * Deliberately no delete: this assistant edits schedules and notes, and
 * anything destructive stays a human action in the UI.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/** The calendar the crew works off. Created on demand rather than in a
 * migration so it needs no schema change and each org gets one the first time
 * a job is actually scheduled. */
export const JOBS_CALENDAR_NAME = "Jobs";

/** The only job columns this assistant is allowed to write. Narrower than the
 * table on purpose — it also keeps the typed Supabase client happy, which a
 * loose Record<string, unknown> doesn't. */
interface JobPatch {
  status?: string;
  project_start_date?: string;
  project_end_date?: string;
  client_notes?: string;
}

export interface ToolResult {
  ok: boolean;
  [key: string]: unknown;
}

function fail(message: string): ToolResult {
  return { ok: false, error: message };
}

/** Tool definitions handed to the model. Descriptions say *when* to reach for
 * each one, not just what it does — that's what drives correct triggering. */
export const ASSISTANT_TOOLS = [
  {
    name: "find_client",
    description:
      "Look up a client by name (partial names are fine) and get back their properties and jobs, with each job's id, status, and current dates. Call this first whenever the person names a client — you need the job id before you can change anything. If more than one client matches, ask which one they mean instead of guessing.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "All or part of the client's name, e.g. 'Mike'." },
      },
      required: ["name"],
    },
  },
  {
    name: "update_job",
    description:
      "Change a job's status, dates, or notes. Use this to record that work started, that it isn't finished, or when the crew is returning. Only pass the fields you actually want to change — anything you leave out keeps its current value. project_start_date is the day work began; project_end_date is the day the crew expects to finish, so a return visit means setting project_end_date to that day.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "The job's id, from find_client." },
        status: {
          type: "string",
          enum: ["estimating", "quoted", "approved", "in_progress", "completed", "cancelled"],
          description: "Set 'in_progress' when work has started but isn't finished.",
        },
        project_start_date: { type: "string", description: "YYYY-MM-DD, the day work began." },
        project_end_date: {
          type: "string",
          description: "YYYY-MM-DD, the day the crew expects to finish. This is what puts the job on the crew's calendar.",
        },
        note: {
          type: "string",
          description:
            "Appended to the job's notes with today's date, so the history builds up instead of overwriting. Use it for what's left to do.",
        },
      },
      required: ["job_id"],
    },
  },
  {
    name: "schedule_job_on_calendar",
    description:
      "Put a job on the crew's Jobs calendar for a given day, creating that calendar if the business doesn't have one yet. Call this after update_job when the person says the crew is going back out on a specific day. The date must be YYYY-MM-DD — resolve words like 'Monday' or 'tomorrow' into a real date yourself using today's date, and say which date you picked.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "The job's id, from find_client." },
        date: { type: "string", description: "YYYY-MM-DD, the day the crew is working this job." },
      },
      required: ["job_id", "date"],
    },
  },
  {
    name: "list_calendars",
    description:
      "List the business's calendars. Use it when the person asks what calendars exist or which one something is on.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

/** Finds or creates the org's Jobs calendar. Uses the caller's org via the
 * same current_org_id() the RLS policies use, so it can't create a calendar
 * for someone else's business. */
async function ensureJobsCalendar(
  supabase: SupabaseClient
): Promise<{ id: string; created: boolean } | null> {
  const { data: existing } = await supabase
    .from("calendars")
    .select("id")
    .ilike("name", JOBS_CALENDAR_NAME)
    .maybeSingle();
  if (existing) return { id: existing.id as string, created: false };

  // organization_id isn't defaulted, so read it the same way the app does
  // everywhere else — off an existing row the caller can already see.
  const { data: anyCalendar } = await supabase.from("calendars").select("organization_id").limit(1).maybeSingle();
  if (!anyCalendar) return null;

  const { data: created, error } = await supabase
    .from("calendars")
    .insert({
      organization_id: anyCalendar.organization_id,
      name: JOBS_CALENDAR_NAME,
      color: "#b45309",
      description: "Scheduled job work days — what the crew works off.",
    })
    .select("id")
    .single();
  if (error || !created) return null;
  return { id: created.id as string, created: true };
}

export async function runAssistantTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const supabase = await createClient();

  try {
    switch (name) {
      case "find_client": {
        const query = String(input.name ?? "").trim();
        if (!query) return fail("Give me a name to search for.");

        const { data: customers, error } = await supabase
          .from("customers")
          .select("id, name, email, phone, properties(id, address, jobs(id, name, status, project_start_date, project_end_date, evaluation_date, client_notes))")
          .ilike("name", `%${query}%`)
          .limit(5);
        if (error) return fail(error.message);
        if (!customers || customers.length === 0) return { ok: true, matches: [], note: `No client matching "${query}".` };

        return { ok: true, matches: customers };
      }

      case "update_job": {
        const jobId = String(input.job_id ?? "");
        if (!jobId) return fail("job_id is required.");

        const patch: JobPatch = {};
        if (typeof input.status === "string") patch.status = input.status;
        if (typeof input.project_start_date === "string") patch.project_start_date = input.project_start_date;
        if (typeof input.project_end_date === "string") patch.project_end_date = input.project_end_date;

        // Notes append rather than replace — the running history of a job is
        // worth more than whatever the latest sentence happens to be.
        if (typeof input.note === "string" && input.note.trim()) {
          const { data: job } = await supabase.from("jobs").select("client_notes").eq("id", jobId).maybeSingle();
          const stamp = new Date().toISOString().slice(0, 10);
          const line = `[${stamp}] ${input.note.trim()}`;
          patch.client_notes = job?.client_notes ? `${job.client_notes}\n${line}` : line;
        }

        if (Object.keys(patch).length === 0) return fail("Nothing to change — pass at least one field.");

        const { data: updated, error } = await supabase
          .from("jobs")
          .update(patch)
          .eq("id", jobId)
          .select("id, name, status, project_start_date, project_end_date, client_notes")
          .maybeSingle();
        if (error) return fail(error.message);
        if (!updated) return fail("No job with that id, or you don't have access to it.");

        return { ok: true, job: updated };
      }

      case "schedule_job_on_calendar": {
        const jobId = String(input.job_id ?? "");
        const date = String(input.date ?? "");
        if (!jobId || !date) return fail("job_id and date are both required.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("date must be YYYY-MM-DD.");

        const calendar = await ensureJobsCalendar(supabase);
        if (!calendar) return fail("Couldn't find or create the Jobs calendar.");

        // A job shows on the crew calendar across its project dates, so
        // scheduling a day means making sure that day is inside the range.
        const { data: job, error: readError } = await supabase
          .from("jobs")
          .select("id, name, project_start_date, project_end_date")
          .eq("id", jobId)
          .maybeSingle();
        if (readError) return fail(readError.message);
        if (!job) return fail("No job with that id, or you don't have access to it.");

        const patch: JobPatch = { project_end_date: date };
        if (!job.project_start_date) patch.project_start_date = date;

        const { data: updated, error } = await supabase
          .from("jobs")
          .update(patch)
          .eq("id", jobId)
          .select("id, name, project_start_date, project_end_date")
          .maybeSingle();
        if (error) return fail(error.message);

        return {
          ok: true,
          job: updated,
          calendar: JOBS_CALENDAR_NAME,
          calendar_created: calendar.created,
          scheduled_for: date,
        };
      }

      case "list_calendars": {
        const { data, error } = await supabase.from("calendars").select("id, name, description, is_system").order("name");
        if (error) return fail(error.message);
        return { ok: true, calendars: data ?? [] };
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (err) {
    console.error(`Assistant tool ${name} failed:`, err);
    return fail(err instanceof Error ? err.message : "Something went wrong running that.");
  }
}
