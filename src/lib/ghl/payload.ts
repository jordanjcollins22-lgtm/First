/**
 * What an evaluation looks like on the GoHighLevel calendar.
 *
 * Pure, so the shape of what is sent can be tested without a token. The
 * end time falls back to an hour after the start, which is what the app
 * itself assumes when no end was booked.
 */
export interface EvaluationForGhl {
  customerName: string;
  address: string;
  startsAt: string;
  endsAt: string | null;
  mode: "in_person" | "digital" | string;
}

export const DEFAULT_MINUTES = 60;

export function appointmentTitle(e: Pick<EvaluationForGhl, "customerName" | "address" | "mode">): string {
  const kind = e.mode === "digital" ? "Video walkthrough" : "Evaluation";
  const street = e.address.split(",")[0]?.trim() || e.address;
  return `${kind}: ${e.customerName} at ${street}`;
}

export function appointmentWindow(e: Pick<EvaluationForGhl, "startsAt" | "endsAt">): { startTime: string; endTime: string } {
  const start = new Date(e.startsAt);
  const end = e.endsAt ? new Date(e.endsAt) : new Date(start.getTime() + DEFAULT_MINUTES * 60_000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

/** First and last name the way GoHighLevel keeps them. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Client", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
