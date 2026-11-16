import type { Stage } from "@/lib/hiring/screening";

/**
 * Recorded calls in hiring: every interview call, check-in and review is
 * recorded, with everyone on it told first. Maryland is an all-party consent
 * state, so a call is recorded only after the other person has heard this
 * line and said OK.
 */

/** Written in the interview, offer and welcome emails. */
export function recordingNotice(business: string): string {
  return `Interviews, calls and check-ins with ${business} are recorded for training and quality.`;
}

/** What the person recording reads before Start is allowed. */
export const RECORDING_CONSENT_PROMPT =
  'Before you start, say: "This call is recorded for training and quality. Is that OK?" Maryland law says everyone on the call has to know and agree. Put a phone call on speaker so both voices are recorded.';

export const RECORDING_BUCKET = "call-recordings";

/** Where the storage takes one upload (the project setting, 50 MB). */
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

/** Audio only, low bitrate: 32 kbps is about 14 MB an hour. */
export const RECORDING_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  // Some phones label an audio-only recording as video.
  "video/webm": "webm",
  "video/mp4": "mp4",
};

export type RecordingOwner = "applicant" | "newhire";

/** Applicant calls, in the order of the hiring steps. */
export const APPLICANT_CALLS = {
  screening: "Screening call",
  interview: "First interview",
  owner_talk: "Owner call",
} as const;
export type ApplicantCall = keyof typeof APPLICANT_CALLS;

export function isApplicantCall(value: string): value is ApplicantCall {
  return value in APPLICANT_CALLS;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function recordingExt(type: string): string | null {
  return RECORDING_TYPES[type.split(";")[0].trim().toLowerCase()] ?? null;
}

/** Each recording sits under its business, then the applicant or new hire it belongs to. */
export function recordingPrefix(organizationId: string, owner: RecordingOwner, id: string): string {
  return `${organizationId}/${owner}/${id}/`;
}

/** Whether a path is a recording made for this applicant or new hire, and nothing else. */
export function isRecordingPathFor(path: string, organizationId: string, owner: RecordingOwner, id: string): boolean {
  const prefix = recordingPrefix(organizationId, owner, id);
  if (!path.startsWith(prefix)) return false;
  return new RegExp(`^${UUID}\\.(${[...new Set(Object.values(RECORDING_TYPES))].join("|")})$`).test(path.slice(prefix.length));
}

/**
 * The call that has to be recorded before an application can leave a stage
 * going forward: the first interview before the skills step or owner call,
 * the owner call before the offer. Saying no, or them withdrawing, never
 * waits on a recording.
 */
export function callNeededToMove(from: Stage, to: Stage): ApplicantCall | null {
  if (from === "interview" && (to === "working_interview" || to === "owner_talk")) return "interview";
  if (from === "owner_talk" && to === "offer_sent") return "owner_talk";
  return null;
}

/** Steps on a new hire's page that are calls, so are only logged with a recording. */
export function stepNeedsRecording(kind: string): boolean {
  return kind === "checkin" || kind === "review";
}
