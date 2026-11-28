import { createClient } from "@/lib/supabase/server";
import { dateKeyIn } from "@/lib/time-zone";
import type { ApplicantRow } from "@/lib/data/hiring";
import type { Profile } from "@/types/domain";

/** Anything with a time on the schedule that is not a crew work day: paid site visits and hiring interviews. */
export interface Appointment {
  id: string;
  kind: "visit" | "interview";
  at: string;
  day: string;
  name: string;
  what: string;
  href: string;
}

/** One crew work day already gone by, for History. */
export interface PastDay {
  sessionId: string;
  jobId: string;
  day: string;
  customerName: string;
  work: string;
  done: boolean;
}

/**
 * Paid site visits between two days. The owner sees every one; an account
 * manager sees their own clients' (and any nobody is set on).
 */
export async function loadSiteVisits(profile: Profile, from: string, to: string, everyone: boolean): Promise<Appointment[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("jobs")
    .select("id,name,evaluation_date,evaluation_status,cancelled_at,property:properties!inner(customer:customers!inner(name,account_manager_id,organization_id))")
    .eq("property.customer.organization_id", profile.organization_id)
    .gte("evaluation_date", `${from}T00:00:00`)
    .lte("evaluation_date", `${to}T23:59:59`)
    .is("cancelled_at", null)
    .order("evaluation_date", { ascending: true })
    .limit(300);
  type R = {
    id: string;
    name: string | null;
    evaluation_date: string;
    evaluation_status: string | null;
    property: { customer: { name: string | null; account_manager_id: string | null } } | null;
  };
  return ((data ?? []) as unknown as R[])
    .filter((j) => j.evaluation_status !== "cancelled" && j.evaluation_status !== "no_show")
    .filter((j) => {
      if (everyone) return true;
      const am = j.property?.customer?.account_manager_id;
      return !am || am === profile.id;
    })
    .map((j) => ({
      id: j.id,
      kind: "visit" as const,
      at: j.evaluation_date,
      day: dateKeyIn(new Date(j.evaluation_date)),
      name: j.property?.customer?.name || "Client",
      what: "Site visit",
      href: `/jobs/${j.id}`,
    }));
}

/** Hiring interviews booked between two days. */
export function interviewsBetween(applicants: ApplicantRow[], from: string, to: string): Appointment[] {
  return applicants
    .filter((a) => a.interviewAt && (a.stage === "interview" || a.stage === "working_interview"))
    .map((a) => ({
      id: a.id,
      kind: "interview" as const,
      at: a.interviewAt!,
      day: dateKeyIn(new Date(a.interviewAt!)),
      name: a.name,
      what: `Interview · ${a.position.replace("-", " ")}`,
      href: `/admin/hiring/${a.id}`,
    }))
    .filter((v) => v.day >= from && v.day <= to);
}

/** Crew work days from `from` up to the day before `today`, newest first. */
export async function loadPastCrewDays(from: string, today: string): Promise<PastDay[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("job_work_sessions")
    .select("id, job_id, starts_on, ends_on, status, jobs(name, status, properties(customers(name)))")
    .gte("starts_on", from)
    .lt("starts_on", today)
    .neq("status", "cancelled")
    .is("subcontractor_id", null)
    .order("starts_on", { ascending: false })
    .limit(300);
  type R = {
    id: string;
    job_id: string;
    starts_on: string;
    status: string;
    jobs: { name: string | null; status: string; properties: { customers: { name: string | null } | null } | null } | null;
  };
  return ((data ?? []) as unknown as R[])
    .filter((r) => r.jobs?.status !== "cancelled")
    .map((r) => ({
      sessionId: r.id,
      jobId: r.job_id,
      day: r.starts_on,
      customerName: r.jobs?.properties?.customers?.name || "Client",
      work: r.jobs?.name || "Work day",
      done: r.status === "done" || r.jobs?.status === "completed",
    }));
}
