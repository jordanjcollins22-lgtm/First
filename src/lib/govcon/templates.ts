/**
 * Message templates. Pure functions so they're testable and so the wording
 * lives in one place.
 */

export interface CompanyInfo {
  name: string;
  uei: string | null;
  cage: string | null;
  address: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Fallback sub-facing scope when no AI analysis is available: the notice
 * text with government identifiers and contact details stripped, so subs
 * see the work but can't route around us to the contracting officer.
 */
export function sanitizeScopeForSub(text: string, identifiers: Array<string | null | undefined>): string {
  let out = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[contact removed]")
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[phone removed]")
    .replace(/https?:\/\/\S*sam\.gov\S*/gi, "")
    .replace(/\b(contracting officer|contract specialist|point of contact)\b[^.\n]*/gi, "");
  for (const id of identifiers) {
    if (id && id.length >= 4) out = out.split(id).join("[ref]");
  }
  return out.trim();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export function rfqEmail(input: {
  company: CompanyInfo;
  subName: string;
  tradeLabel: string;
  location: string;
  scopeSummary: string;
  quoteDueAt: string | null;
  portalUrl: string;
  requiresSmallBusiness: boolean;
  wageDetermination: string | null;
  followup?: number;
}): { subject: string; text: string } {
  const { company } = input;
  const due = formatDate(input.quoteDueAt);
  const prefix = input.followup ? "Reminder: " : "";
  const subject = `${prefix}Quote request – ${input.tradeLabel} in ${input.location} (due ${due})`;
  const lines = [
    `Hi ${input.subName} team,`,
    "",
    input.followup
      ? `Following up on our request below — we'd still love your price for this job. Quotes are due ${due}.`
      : `${company.name} is bidding on a commercial ${input.tradeLabel.toLowerCase()} job in ${input.location} and is looking for a local company to perform the work. Is this something you'd take on?`,
    "",
    `Scope (short version): ${input.scopeSummary}`,
    "",
    `Full scope of work and a 2-minute quote form:`,
    input.portalUrl,
    "",
    `Please send your price by ${due}. In the form we'll ask for:`,
    `  1. Your firm price for the full scope (and per period if multi-year)`,
    `  2. Whether you can work on net-30 payment terms`,
    `  3. Two references for similar work`,
    input.requiresSmallBusiness
      ? `  4. Confirmation you're a small business and will use your own employees (required for this contract)`
      : `  4. Whether the work will be done by your own employees`,
    input.wageDetermination
      ? `\nThis is a federal service contract: Service Contract Act wages and fringe benefits under wage determination ${input.wageDetermination} apply and will be part of the subcontract.`
      : "",
    "",
    `If we win, we'll issue a subcontract and coordinate the start date with you.`,
    "",
    `Thanks,`,
    company.contactName ?? company.name,
    company.name,
    company.phone ?? "",
  ];
  return { subject, text: lines.filter((l) => l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n") };
}

export function callScript(input: { company: CompanyInfo; tradeLabel: string; location: string; scopeSummary: string }): string {
  return `Hi, this is ${input.company.contactName ?? "[name]"} with ${input.company.name}. Do you do commercial ${input.tradeLabel.toLowerCase()} work? We have a project near ${input.location}: ${input.scopeSummary} Is that something you could do? Great — what's the best email to send the full scope of work so you can quote it?`;
}
