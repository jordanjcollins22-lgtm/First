/**
 * Paying by cash or check: what the client is told, and what the office is.
 *
 * A client who chooses this is not paying on the screen; somebody has to go
 * and get it. So the words have to say two things plainly: to the client,
 * that we will come to them; to the account manager, exactly whose money,
 * how much, and where.
 */

export type OfflineMethod = "cash" | "check";

export const OFFLINE_METHODS: OfflineMethod[] = ["cash", "check"];

export function isOfflineMethod(value: unknown): value is OfflineMethod {
  return value === "cash" || value === "check";
}

export function offlineMethodLabel(method: OfflineMethod): string {
  return method === "cash" ? "cash" : "check";
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** What the client sees once they have chosen. */
export function offlineConfirmation(method: OfflineMethod, amountCents: number, managerFirstName: string | null): string {
  const who = managerFirstName ? `${managerFirstName}` : "Your account manager";
  return `Got it. ${who} will arrange to collect ${money(amountCents)} by ${offlineMethodLabel(method)}. Next, pick the day you would like us.`;
}

/** The note that goes on the job's thread for everybody to see. */
export function offlineThreadNote(method: OfflineMethod, amountCents: number): string {
  return `Chose to pay ${money(amountCents)} by ${offlineMethodLabel(method)}. To be collected by the account manager.`;
}

export interface CollectEmailInput {
  clientName: string;
  amountCents: number;
  method: OfflineMethod;
  address: string | null;
  phone: string | null;
  jobUrl: string;
  managerFirstName: string | null;
}

/** The email to whoever collects it. Short, and everything needed is in it. */
export function collectEmail(input: CollectEmailInput): { subject: string; text: string } {
  const label = offlineMethodLabel(input.method);
  const subject = `${input.clientName} wants to pay ${money(input.amountCents)} by ${label}`;
  const lines = [
    `${input.managerFirstName ? `${input.managerFirstName}, ` : ""}${input.clientName} just signed and chose to pay by ${label} instead of card.`,
    "",
    `Amount: ${money(input.amountCents)}`,
    input.address ? `Address: ${input.address}` : null,
    input.phone ? `Phone: ${input.phone}` : null,
    "",
    "Arrange a time to pick it up. When you have it, open the job and press \"Mark picked up\" on the invoice so the books and Stripe both show it paid:",
    input.jobUrl,
  ].filter((l): l is string => l !== null);
  return { subject, text: lines.join("\n") };
}

/** The line on the invoice card while it waits. */
export function awaitingLine(method: OfflineMethod, requestedAt: string | null, when: (iso: string) => string): string {
  const label = offlineMethodLabel(method);
  return requestedAt ? `Client asked to pay by ${label} on ${when(requestedAt)}. Collect it and mark it here.` : `Client asked to pay by ${label}. Collect it and mark it here.`;
}

/** The note on the job's thread once it is in hand. */
export function collectedThreadNote(method: OfflineMethod, amountCents: number, collectorName: string): string {
  return `${money(amountCents)} received by ${offlineMethodLabel(method)}. Picked up by ${collectorName}.`;
}
