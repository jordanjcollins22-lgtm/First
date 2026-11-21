/**
 * The crew's link to one job, opened with no login.
 *
 * The link is the job's own id. A job id is a random UUID (122 random bits),
 * so it cannot be guessed or counted through, and nothing has to be stored or
 * set up for a job to have one: every job, old or new, has its link already.
 * The only other place a job id shows outside the office is inside that same
 * client's own photo addresses, and the crew page shows nothing about money,
 * so a client who found it would only see their own project without prices.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crewPath(jobId: string): string {
  return `/crew/${jobId}`;
}

/** The job a crew link is for, or null for something that is not a job id. */
export function jobIdFromCrewToken(token: string): string | null {
  const id = decodeURIComponent(token).trim();
  return UUID.test(id) ? id.toLowerCase() : null;
}
