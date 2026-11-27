import { HEARD_ABOUT_LABEL } from "@/lib/heard-about";

export interface NewLeadDetails {
  name: string;
  phone: string;
  email: string;
  address: string;
  /** Where the booking came from: "Facebook ad", "Tracked link abc", "Booked online". */
  source: string;
  /** Whose link it came through, in words, when it came through one. */
  referrer: string | null;
  heardAbout: string | null;
  heardAboutDetail: string | null;
  /** What happened on the page: a visit on a date, a photo quote, or just their details. */
  kind: "visit" | "photo_quote" | "lead";
  visitWhen: string | null;
  services: string[];
  budgetRange: string | null;
  notes: string | null;
  returningClient: boolean;
  clientUrl: string;
  managerFirstName: string | null;
}

/** The email the account manager gets for a new lead. Plain text, phone first. */
export function buildNewLeadEmail(d: NewLeadDetails): { subject: string; text: string } {
  const what =
    d.kind === "visit"
      ? `booked an estimate visit${d.visitWhen ? ` for ${d.visitWhen}` : ""}`
      : d.kind === "photo_quote"
        ? "asked for a quote from photos"
        : "left their details for an estimate";

  const heard = d.heardAbout
    ? `${HEARD_ABOUT_LABEL[d.heardAbout] ?? d.heardAbout}${d.heardAboutDetail ? ` (${d.heardAboutDetail})` : ""}`
    : null;

  const lines = [
    d.managerFirstName ? `Hi ${d.managerFirstName},` : "Hi,",
    "",
    `${d.name} just ${what}. Reach out today while they're still thinking about it.`,
    "",
    `Name: ${d.name}${d.returningClient ? " (already a client)" : ""}`,
    `Phone: ${d.phone}`,
    `Email: ${d.email}`,
    `Address: ${d.address}`,
    `Came from: ${d.source}`,
    d.referrer ? `Referrer: ${d.referrer}` : null,
    heard ? `Heard about us: ${heard}` : null,
    d.services.length > 0 ? `Wants: ${d.services.join(", ")}` : null,
    d.budgetRange ? `Budget: ${d.budgetRange}` : null,
    d.notes ? `Their notes: ${d.notes}` : null,
    "",
    `Open the client: ${d.clientUrl}`,
  ];

  return {
    subject: `New lead: ${d.name}, ${shortAddress(d.address)}`,
    text: lines.filter((l): l is string => l !== null).join("\n"),
  };
}

/** "217 Ewing St, Bel Air, MD 21014, USA" -> "217 Ewing St, Bel Air". */
function shortAddress(address: string): string {
  return address.split(",").slice(0, 2).join(",").trim() || address;
}
