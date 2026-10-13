/**
 * The Maryland compliance calendar: what the business has to renew, file or
 * prove, and when.
 *
 * Renewals should never be remembered by hand. Each obligation carries a due
 * date, and the owner hears about it at 60, 30 and 7 days and again when it
 * is overdue. Overdue is an exception: it shows on the needs-you strip until
 * somebody marks it done, which rolls the date to the next one.
 *
 * The seeded dates are sensible Maryland defaults, not facts about this
 * business. Every one is seeded as "confirm the date", and stays flagged
 * until the owner confirms it.
 *
 * Pure: dates in, verdicts out, so the rules are tested without a database.
 */

export type ObligationKind =
  | "mda_business_license"
  | "mda_registered_employees"
  | "pesticide_applicator"
  | "fertilizer_applicator"
  | "mhic_license"
  | "vehicle_registration"
  | "insurance_gl"
  | "insurance_auto"
  | "insurance_workers_comp"
  | "insurance_umbrella"
  | "tax_quarterly"
  | "tax_annual"
  | "h2b"
  | "other";

export const KIND_LABEL: Record<ObligationKind, string> = {
  mda_business_license: "MDA pesticide business license",
  mda_registered_employees: "MDA registered employees",
  pesticide_applicator: "Pesticide applicator certification",
  fertilizer_applicator: "Fertilizer applicator certification",
  mhic_license: "MHIC license",
  vehicle_registration: "Vehicle registration",
  insurance_gl: "General liability insurance",
  insurance_auto: "Commercial auto insurance",
  insurance_workers_comp: "Workers' comp insurance",
  insurance_umbrella: "Umbrella insurance",
  tax_quarterly: "Quarterly tax filing",
  tax_annual: "Annual tax filing",
  h2b: "H-2B",
  other: "Other",
};

export const INSURANCE_KINDS: ObligationKind[] = ["insurance_gl", "insurance_auto", "insurance_workers_comp", "insurance_umbrella"];

export function isInsurance(kind: string): boolean {
  return (INSURANCE_KINDS as string[]).includes(kind);
}

export type Recurrence = "annual" | "biennial" | "quarterly" | "none";

export interface ObligationShape {
  id: string;
  kind: string;
  title: string;
  dueOn: string | null;
  recurrence: Recurrence;
  active: boolean;
  dateConfirmed: boolean;
  creditsRequired?: number | null;
  creditsEarned?: number | null;
}

export const DEFAULT_REMINDER_DAYS = [60, 30, 7];

const DAY = 86_400_000;

/** Whole days from today to the due date: negative once it has passed. */
export function daysUntil(dueOn: string, today: string): number {
  const a = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${dueOn.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / DAY);
}

function iso(y: number, m: number, d: number): string {
  // Clamp the day: Feb 29 in a year without one is Feb 28.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** The next time a month and day comes round, on or after today. */
export function nextAnnual(month: number, day: number, today: string): string {
  const y = Number(today.slice(0, 4));
  const thisYear = iso(y, month, day);
  return thisYear >= today.slice(0, 10) ? thisYear : iso(y + 1, month, day);
}

/** The next of several dates in the year (quarterly filings), on or after today. */
export function nextOfDates(dates: [number, number][], today: string): string {
  return dates.map(([m, d]) => nextAnnual(m, d, today)).sort()[0];
}

/** Quarterly payroll returns (941 and the Maryland withholding return): the month after each quarter ends. */
export const QUARTERLY_PAYROLL_DUE: [number, number][] = [
  [1, 31],
  [4, 30],
  [7, 31],
  [10, 31],
];

/**
 * The due date after this one, once it has been done.
 *
 * Quarterly items step to the next quarterly date after the one just met,
 * not three months on, so a return filed late does not drag every later one
 * with it.
 */
export function rollForward(dueOn: string, recurrence: Recurrence, quarterlyDates: [number, number][] = QUARTERLY_PAYROLL_DUE): string | null {
  const y = Number(dueOn.slice(0, 4));
  const m = Number(dueOn.slice(5, 7));
  const d = Number(dueOn.slice(8, 10));
  if (recurrence === "annual") return iso(y + 1, m, d);
  if (recurrence === "biennial") return iso(y + 2, m, d);
  if (recurrence === "quarterly") {
    const after = iso(y, m, d);
    const next = new Date(Date.parse(`${after}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
    return nextOfDates(quarterlyDates, next);
  }
  return null;
}

export type ObligationState = "inactive" | "no_date" | "overdue" | "due_soon" | "upcoming" | "ok";

/** Where one obligation stands today. "Due soon" is inside the widest reminder window. */
export function obligationState(o: ObligationShape, today: string, reminderDays: number[] = DEFAULT_REMINDER_DAYS): ObligationState {
  if (!o.active) return "inactive";
  if (!o.dueOn) return "no_date";
  const left = daysUntil(o.dueOn, today);
  if (left < 0) return "overdue";
  const widest = Math.max(...reminderDays, 0);
  if (left <= widest) return "due_soon";
  if (left <= widest * 2) return "upcoming";
  return "ok";
}

/**
 * Which reminder is due today, if any: the tightest threshold already
 * crossed. A calendar switched on with 20 days left sends the 30-day
 * reminder once, not the 60 and the 30 together. The caller dedupes on
 * (obligation, due date, threshold), so each goes once per due date.
 */
export function reminderDue(dueOn: string, today: string, reminderDays: number[] = DEFAULT_REMINDER_DAYS): number | "overdue" | null {
  const left = daysUntil(dueOn, today);
  if (left < 0) return "overdue";
  const crossed = [...reminderDays].sort((a, b) => a - b).find((t) => left <= t);
  return crossed ?? null;
}

/** The text the owner gets. */
export function reminderText(o: Pick<ObligationShape, "title" | "dueOn" | "dateConfirmed">, threshold: number | "overdue", today: string): string {
  const confirm = o.dateConfirmed ? "" : " The date is a Maryland default: confirm it in Admin › Settings › Compliance.";
  if (threshold === "overdue") {
    return `Overdue: ${o.title} was due ${o.dueOn}. Mark it done in Admin › Settings › Compliance once it is.${confirm}`;
  }
  const left = daysUntil(o.dueOn!, today);
  return `${o.title} is due ${o.dueOn} (${left === 0 ? "today" : `${left} day${left === 1 ? "" : "s"}`}).${confirm}`;
}

/** Credits still needed for a recertification, or null when it does not count credits. */
export function creditsShort(o: Pick<ObligationShape, "creditsRequired" | "creditsEarned">): number | null {
  if (o.creditsRequired == null) return null;
  return Math.max(0, o.creditsRequired - (o.creditsEarned ?? 0));
}

export interface SeedObligation {
  seedKey: string;
  kind: ObligationKind;
  title: string;
  dueOn: string | null;
  recurrence: Recurrence;
  active: boolean;
  creditsRequired?: number;
  notes: string;
  sourceUrl?: string;
}

const MDA_PDF =
  "https://mda.maryland.gov/plants-pests/SiteAssets/Pages/licensing_and_certification/Pesticide%20Applicator%20Certification%20and%20Business%20Licensing%20Requirements_Rev_07_06_2026%20%281%29%20%281%29.pdf";

/**
 * The Maryland defaults a new calendar starts with. Every date is a default
 * to confirm. Things the business may not have (MHIC, H-2B) start inactive.
 * Insurance expiry dates are the business's own, so they start blank.
 */
export function marylandDefaults(today: string): SeedObligation[] {
  return [
    {
      seedKey: "mda_business_license",
      kind: "mda_business_license",
      title: "MDA pesticide business license renewal",
      dueOn: nextAnnual(6, 30, today),
      recurrence: "annual",
      active: true,
      notes:
        "$150 a year, July–June. Renew online at egov.maryland.gov/mda/pesticides by June 30. Needs a GL COI on file with MDA naming MDA Pesticide Regulation, 50 Harry S Truman Pkwy, Annapolis MD 21401 as certificate holder.",
      sourceUrl: MDA_PDF,
    },
    {
      seedKey: "mda_registered_employees",
      kind: "mda_registered_employees",
      title: "MDA registered employee renewals",
      dueOn: nextAnnual(6, 30, today),
      recurrence: "annual",
      active: true,
      notes: "$30 per employee per year, July–June. Tell MDA within 30 days when a registered employee leaves.",
      sourceUrl: MDA_PDF,
    },
    {
      seedKey: "pesticide_applicator",
      kind: "pesticide_applicator",
      title: "Pesticide applicator recertification",
      dueOn: nextAnnual(6, 30, today),
      recurrence: "annual",
      active: true,
      creditsRequired: 8,
      notes: "Annual. Categories 1, 3, 7, 8, 9, 10 and 13 need 8 credits (1 credit = 30 minutes), or the exams are retaken by June 30.",
      sourceUrl: MDA_PDF,
    },
    {
      seedKey: "fertilizer_applicator",
      kind: "fertilizer_applicator",
      title: "Professional fertilizer applicator certification",
      dueOn: nextAnnual(12, 31, today),
      recurrence: "annual",
      active: true,
      notes: "Expires Dec 31. $100 renewal with proof of recertification training. Also what allows late-fall applications (to 0.5 lb N) until Dec 1.",
      sourceUrl: "https://mda.maryland.gov/Pages/fertilizer.aspx",
    },
    {
      seedKey: "mhic_license",
      kind: "mhic_license",
      title: "MHIC contractor license renewal",
      dueOn: null,
      recurrence: "biennial",
      active: false,
      notes:
        "Only if the business holds one. Needed for planting and hardscape on residential property, not for pure mowing. Renews every 2 years (third-party source: confirm with MHIC, 410-230-6001).",
      sourceUrl: "https://labor.maryland.gov/license/mhic/",
    },
    {
      seedKey: "insurance_gl",
      kind: "insurance_gl",
      title: "General liability policy",
      dueOn: null,
      recurrence: "annual",
      active: true,
      notes: "Enter the expiry date and upload the COI. MDA needs at least $100k/$300k bodily injury and $15k/$30k property damage.",
    },
    {
      seedKey: "insurance_auto",
      kind: "insurance_auto",
      title: "Commercial auto policy",
      dueOn: null,
      recurrence: "annual",
      active: true,
      notes: "Enter the expiry date and upload the COI.",
    },
    {
      seedKey: "insurance_workers_comp",
      kind: "insurance_workers_comp",
      title: "Workers' comp policy",
      dueOn: null,
      recurrence: "annual",
      active: true,
      notes: "Generally required in Maryland with one or more employees (verify with the Workers' Compensation Commission). Enter the expiry date and upload the COI.",
    },
    {
      seedKey: "insurance_umbrella",
      kind: "insurance_umbrella",
      title: "Umbrella policy",
      dueOn: null,
      recurrence: "annual",
      active: true,
      notes: "Commercial and HOA clients often ask for $1–5M. Enter the expiry date and upload the COI.",
    },
    {
      seedKey: "tax_quarterly_payroll",
      kind: "tax_quarterly",
      title: "Quarterly payroll returns (federal 941, Maryland withholding)",
      dueOn: nextOfDates(QUARTERLY_PAYROLL_DUE, today),
      recurrence: "quarterly",
      active: true,
      notes: "Generic reminder. Confirm the forms and dates with the bookkeeper or payroll provider.",
    },
    {
      seedKey: "tax_quarterly_estimated",
      kind: "tax_quarterly",
      title: "Estimated income tax payment",
      dueOn: nextOfDates([[1, 15], [4, 15], [6, 15], [9, 15]], today),
      recurrence: "quarterly",
      active: true,
      notes: "Generic reminder. Confirm with the bookkeeper whether estimated payments apply.",
    },
    {
      seedKey: "tax_annual_w2",
      kind: "tax_annual",
      title: "W-2s and 1099s to staff, subs and the IRS",
      dueOn: nextAnnual(1, 31, today),
      recurrence: "annual",
      active: true,
      notes: "Generic reminder: W-2/W-3 and 1099-NEC are due Jan 31.",
    },
    {
      seedKey: "tax_annual_sdat",
      kind: "tax_annual",
      title: "Maryland annual report and personal property return (SDAT)",
      dueOn: nextAnnual(4, 15, today),
      recurrence: "annual",
      active: true,
      notes: "Generic reminder. Confirm the date with SDAT for the entity type.",
    },
    {
      seedKey: "tax_annual_income",
      kind: "tax_annual",
      title: "Business income tax return",
      dueOn: nextAnnual(3, 15, today),
      recurrence: "annual",
      active: true,
      notes: "Generic reminder: March 15 for partnerships and S corps, April 15 for sole proprietors and C corps. Confirm which applies.",
    },
    {
      seedKey: "h2b",
      kind: "h2b",
      title: "H-2B petition filing",
      dueOn: null,
      recurrence: "annual",
      active: false,
      notes: "Only if the business uses H-2B. FY2026 was oversubscribed again; file as early as the window allows.",
    },
  ];
}

/** The fleet kinds that carry a registration. */
export function isRegisteredVehicle(kind: string | null | undefined): boolean {
  return /truck|van|trailer|vehicle|car|pickup|dump|suv/i.test(kind ?? "");
}
