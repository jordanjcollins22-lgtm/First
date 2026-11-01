/**
 * Keeping the Marketing board's Team pipeline in step with job applicants.
 *
 * Marketing's Team goal is getting people to join the team, so the Team
 * Backlog is the people who applied in the last few weeks and are still in
 * the running: each gets one card, oldest first on the first fill, then new
 * applicants at the bottom. An applicant who withdraws, is screened out or
 * isn't a fit comes off the Backlog; once someone has pulled a card further
 * along, the team moves it on themselves.
 */

import { EXTERNAL_GROUP, type Stage } from "@/lib/kanban/board";
import { NEW_LEAD_DAYS } from "@/lib/kanban/customer-sync";

/** Applicants are new for as long as clients are. */
export const NEW_APPLICANT_DAYS = NEW_LEAD_DAYS;

/** Hiring stages that end an application before anyone is hired. */
const OUT = new Set(["screened_out", "not_a_fit", "withdrawn"]);

export interface Applicant {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  zip: string | null;
  position: string;
  source: string | null;
  stage: string;
  video_submitted_at: string | null;
  interview_at: string | null;
  created_at: string;
}

export interface ApplicantCard {
  applicant_id: string;
  pipeline: "team";
  title: string;
  asked_by: null;
  details: string;
  backlog_group: string;
}

/** "project-technician" -> "Project technician". */
function positionLabel(position: string): string {
  const words = position.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function cardForApplicant(a: Applicant): ApplicantCard {
  const lines = [
    `Position: ${positionLabel(a.position)}`,
    a.phone ? `Phone: ${a.phone}` : null,
    a.email ? `Email: ${a.email}` : null,
    a.zip ? `Zip: ${a.zip}` : null,
    `Source: ${a.source?.trim() || "Unknown"}`,
  ].filter(Boolean);
  return {
    applicant_id: a.id,
    pipeline: "team",
    title: a.name.trim() || "New applicant",
    asked_by: null,
    details: lines.join("\n"),
    backlog_group: EXTERNAL_GROUP,
  };
}

export function isActiveApplicant(a: Pick<Applicant, "stage">): boolean {
  return !OUT.has(a.stage);
}

/**
 * Cards to add for applicants still in the running, and Backlog cards to take
 * off for applicants who are out. `applicants` is the recent ones, in any stage.
 */
export function planApplicantSync(
  applicants: readonly Applicant[],
  cards: readonly { id: string; applicant_id: string; stage: Stage }[]
): { toAdd: ApplicantCard[]; toRemove: string[] } {
  const carded = new Set(cards.map((c) => c.applicant_id));
  const out = new Set(applicants.filter((a) => !isActiveApplicant(a)).map((a) => a.id));
  return {
    toAdd: applicants
      .filter((a) => isActiveApplicant(a) && !carded.has(a.id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(cardForApplicant),
    toRemove: cards.filter((c) => c.stage === "backlog" && out.has(c.applicant_id)).map((c) => c.id),
  };
}

/** A yes/no shown on a card, answering the board's questions from the app. */
export interface CardCheck {
  label: string;
  yes: boolean;
}

/** Did they send their video, book an interview, and join the team? */
export function applicantChecks(a: Pick<Applicant, "stage" | "video_submitted_at" | "interview_at">): CardCheck[] {
  const hired = a.stage === "hired";
  const interviewed = hired || a.stage === "interview" || a.interview_at != null;
  return [
    { label: "Sent video", yes: interviewed || a.stage === "video_submitted" || a.video_submitted_at != null },
    { label: "Booked interview", yes: interviewed },
    { label: "Joined team", yes: hired },
  ];
}
