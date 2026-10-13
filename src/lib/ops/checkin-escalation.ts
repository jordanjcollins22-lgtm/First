/**
 * Who hears that a crew member has gone quiet, and when the owner does.
 *
 * The morning check used to text the owner about everybody. The project lead
 * on that job is the one who can do something about it: they know whether
 * Shalon is running late or stuck behind a school bus. So the lead hears
 * first, and the owner only if the lead has not said "on it" within half an
 * hour. If the quiet person is the lead, or the job has no lead, it goes
 * straight to the owner, because there is nobody else to ask.
 */

export const DEFAULT_ESCALATE_MINUTES = 30;
/** Nobody is chased after midday: by then the day has been sorted out by phone. */
export const CHECKIN_WINDOW_END_MINUTES = 12 * 60;

export interface AlertRoute {
  /** Who is texted now. */
  first: string[];
  /** Who is texted if nobody acknowledges in time. Empty when the owners already heard. */
  escalateTo: string[];
  /** The lead was skipped, and why. */
  skippedLead: "no_lead" | "lead_is_quiet" | null;
}

export function routeAlert(input: { quietId: string; leadId: string | null; ownerIds: readonly string[] }): AlertRoute {
  const owners = [...new Set(input.ownerIds)].filter((id) => id !== input.quietId);
  if (!input.leadId) return { first: owners, escalateTo: [], skippedLead: "no_lead" };
  if (input.leadId === input.quietId) return { first: owners, escalateTo: [], skippedLead: "lead_is_quiet" };
  return { first: [input.leadId], escalateTo: owners.filter((id) => id !== input.leadId), skippedLead: null };
}

export interface AlertState {
  alertedAt: string;
  acknowledgedAt: string | null;
  escalatedAt: string | null;
  /** The quiet person turned up in the app since. */
  resolvedAt: string | null;
}

export function shouldEscalate(alert: AlertState, now: Date, minutes = DEFAULT_ESCALATE_MINUTES): boolean {
  if (alert.acknowledgedAt || alert.escalatedAt || alert.resolvedAt) return false;
  return now.getTime() - new Date(alert.alertedAt).getTime() >= minutes * 60_000;
}

/** "Shalon hasn't opened the app today. First stop: X. Tap if you're on it: link" */
export function leadAlertLine(name: string, firstStop: string | null, ackUrl: string | null): string {
  const base = `${name} hasn't opened the app today.${firstStop ? ` First stop: ${firstStop}.` : ""}`;
  return ackUrl ? `${base} Tap if you're on it: ${ackUrl}` : base;
}

export function escalationLine(name: string, leadName: string | null, minutes: number): string {
  return leadName
    ? `${name} still hasn't opened the app, and ${leadName} hasn't answered in ${minutes} minutes.`
    : `${name} still hasn't opened the app today.`;
}
