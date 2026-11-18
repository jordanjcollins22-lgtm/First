/**
 * Step 0.11 of the hiring structure: frontline hiring is a numbers game.
 * At least 40 interviews for every hire, in every job (Alex Hormozi's number,
 * a minimum, never a cap). Working
 * back from that with our own steps (application, video, interview) gives
 * how many applications to aim for before posting.
 *
 * The rates are first guesses, for the owner to correct once real numbers
 * come in; `actualRates` measures them from the board.
 */

export interface FunnelRates {
  /** Applications that pass the knockout questions. */
  passScreen: number;
  /** Of those, how many send the video. */
  sendVideo: number;
  /** Of the videos, how many are invited to interview. */
  inviteInterview: number;
}

export const INTERVIEWS_PER_HIRE = 40;

export const DEFAULT_RATES: FunnelRates = { passScreen: 0.7, sendVideo: 0.5, inviteInterview: 0.6 };

export interface Target {
  hires: number;
  interviews: number;
  videos: number;
  applications: number;
}

/** How many of each to aim for, to make `hires` hires. */
export function targetFor(hires: number, rates: FunnelRates = DEFAULT_RATES, interviewsPerHire = INTERVIEWS_PER_HIRE): Target {
  const h = Math.max(1, Math.round(hires));
  const interviews = h * interviewsPerHire;
  const videos = Math.ceil(interviews / rates.inviteInterview);
  const applications = Math.ceil(videos / (rates.sendVideo * rates.passScreen));
  return { hires: h, interviews, videos, applications };
}

export interface FunnelCounts {
  applications: number;
  passed: number;
  videos: number;
  interviews: number;
  hires: number;
}

const INTERVIEWED = new Set(["interview", "working_interview", "owner_talk", "offer_sent", "hired"]);
const VIDEO = new Set(["video_submitted", ...INTERVIEWED]);
const PASSED = new Set(["video_requested", ...VIDEO]);

/** Count a list of applicants by how far each got. not_a_fit and withdrawn count as far as the step they reached is known: only as applications. */
export function countFunnel(stages: readonly string[]): FunnelCounts {
  return {
    applications: stages.length,
    passed: stages.filter((s) => PASSED.has(s)).length,
    videos: stages.filter((s) => VIDEO.has(s)).length,
    interviews: stages.filter((s) => INTERVIEWED.has(s)).length,
    hires: stages.filter((s) => s === "hired").length,
  };
}
