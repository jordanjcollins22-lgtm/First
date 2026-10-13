/**
 * What one snow event costs one client, by the contract they are on.
 *
 * Pure. The four commercial ways to bill snow, plus the prepaid treatments
 * the salt page sells:
 *
 * - per push: each time the plow goes through, at the rate per push.
 * - per application: each time salt goes down, at the rate per application.
 * - per event: one price for the storm, however many visits it took.
 * - seasonal: one price for the winter. Never billed per event, but the
 *   event is still logged, because proof of service is what a seasonal
 *   client asks for when the lot was icy.
 * - prepaid: treatments already paid for. Each application draws one down.
 *
 * Snow invoices should carry the date, the depth, the passes and the salt,
 * with photos, because the first question on a snow bill is "did you
 * actually come". So the description says all of it.
 */

export type ContractType = "prepaid" | "per_push" | "per_application" | "per_event" | "seasonal";

export const CONTRACT_TYPES: ContractType[] = ["prepaid", "per_push", "per_application", "per_event", "seasonal"];

export const CONTRACT_LABEL: Record<ContractType, string> = {
  prepaid: "Prepaid treatments",
  per_push: "Per push",
  per_application: "Per application",
  per_event: "Per event",
  seasonal: "Seasonal",
};

export function isContractType(value: unknown): value is ContractType {
  return typeof value === "string" && (CONTRACT_TYPES as string[]).includes(value);
}

export interface SnowContract {
  type: ContractType;
  ratePerPushCents: number | null;
  ratePerApplicationCents: number | null;
  ratePerEventCents: number | null;
  seasonalPriceCents: number | null;
}

export interface LoggedStop {
  status: "pending" | "done" | "skipped";
  servicedAt: string | null;
  service: "pretreat" | "salt" | "plow" | "plow_and_salt" | null;
  pushes: number;
  applications: number;
  saltLbs: number | null;
  depthIn: number | null;
  photoCount: number;
}

export type SnowBill =
  | { bill: true; amountCents: number; quantity: number; unitCents: number; description: string }
  | { bill: false; reason: string };

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** Pushes counted: what was logged, or one if the stop was plowed and nobody counted. */
export function pushesOf(stop: LoggedStop): number {
  if (stop.pushes > 0) return stop.pushes;
  return stop.service === "plow" || stop.service === "plow_and_salt" ? 1 : 0;
}

/** Applications counted the same way. A pre-treat is an application. */
export function applicationsOf(stop: LoggedStop): number {
  if (stop.applications > 0) return stop.applications;
  return stop.service === "salt" || stop.service === "plow_and_salt" || stop.service === "pretreat" ? 1 : 0;
}

/**
 * The bill for one client for one event, or the reason there is none.
 *
 * Never invents a price: a contract with no rate on it is not billed, and
 * says so, so the office can set the rate rather than find a $0 invoice.
 */
export function snowBillFor(contract: SnowContract, stop: LoggedStop, eventLabel: string, servicedAtText: string | null): SnowBill {
  if (stop.status !== "done") return { bill: false, reason: stop.status === "skipped" ? "Skipped in this event." : "Not serviced in this event." };
  if (contract.type === "prepaid") return { bill: false, reason: "Prepaid: drawn from the treatments already paid for." };
  if (contract.type === "seasonal") return { bill: false, reason: "Seasonal contract: billed once for the winter." };

  let quantity = 0;
  let unit: number | null = null;
  let noun = "";
  if (contract.type === "per_push") {
    quantity = pushesOf(stop);
    unit = contract.ratePerPushCents;
    noun = quantity === 1 ? "push" : "pushes";
  } else if (contract.type === "per_application") {
    quantity = applicationsOf(stop);
    unit = contract.ratePerApplicationCents;
    noun = quantity === 1 ? "application" : "applications";
  } else {
    quantity = 1;
    unit = contract.ratePerEventCents;
    noun = "event";
  }

  if (unit == null || !(unit > 0)) return { bill: false, reason: `No ${CONTRACT_LABEL[contract.type].toLowerCase()} rate is set on this contract.` };
  if (quantity <= 0) return { bill: false, reason: contract.type === "per_push" ? "No pushes logged." : "No applications logged." };

  const parts = [`${eventLabel}: ${quantity} ${noun} at ${dollars(unit)}`];
  if (servicedAtText) parts.push(`serviced ${servicedAtText}`);
  if (stop.depthIn != null && stop.depthIn > 0) parts.push(`${stop.depthIn} in on the ground`);
  if (stop.saltLbs != null && stop.saltLbs > 0) parts.push(`${stop.saltLbs} lb of melt`);
  if (stop.photoCount > 0) parts.push(`${stop.photoCount} photo${stop.photoCount === 1 ? "" : "s"} on file`);
  return { bill: true, amountCents: quantity * unit, quantity, unitCents: unit, description: parts.join(", ") };
}

/** How many prepaid treatments one stop uses up. */
export function prepaidDraw(stop: LoggedStop): number {
  if (stop.status !== "done") return 0;
  return Math.max(1, applicationsOf(stop));
}

/** The client's notice for a stop. "Your property was serviced at 5:12 AM." */
export function servicedNotice(input: { firstName: string | null; business: string; timeText: string; proofUrl: string | null }): string {
  const hi = input.firstName ? `Hi ${input.firstName}, ` : "Hi, ";
  const proof = input.proofUrl ? ` Photos: ${input.proofUrl}` : "";
  return `${hi}${input.business} here. Your property was serviced at ${input.timeText}.${proof}`;
}

/** The key that keeps one stop's notice from going twice. */
export function servicedDedupeKey(stopId: string, channel: string): string {
  return `snow_serviced:${stopId}:${channel}`;
}
