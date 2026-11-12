/**
 * Everything about one person, for the card opened on the board and for
 * Breakdown. Pure: the loader (lib/data/comms-person.ts) reads the rows into
 * PersonRaw, and the review sample writes PersonRaw by hand, so both draw the
 * same sections through the same code.
 */

import { CHANNELS, replyCheck, type BoardMessage } from "@/lib/comms-board";
import { money, type MaterialFact, type PersonFacts, type SlotFact, type ZoneFact } from "@/lib/comms-intents";

export interface PersonRaw {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
    tags: string[];
    source: string | null;
    contactType: string | null;
    doNotContact: boolean;
    createdAt: string | null;
  } | null;
  properties: { id: string; address: string; sqft: number | null; acreage: number | null; notes: string | null }[];
  jobs: {
    id: string;
    name: string | null;
    jobNumber: string | null;
    status: string;
    createdAt: string;
    evaluationDate: string | null;
    projectStartDate: string | null;
    projectEndDate: string | null;
    completedAt: string | null;
    heardAbout: string | null;
    clientNotes: string | null;
  }[];
  proposals: {
    id: string;
    jobId: string;
    token: string;
    status: string;
    totalCents: number | null;
    sentAt: string | null;
    paidAt: string | null;
    paymentPath: string | null;
    estimate: { crew: number; days: number; billedHours: number; materialsCents: number | null } | null;
    zones: ZoneFact[];
  }[];
  archivedProposals: { id: string; title: string | null; outcome: string | null; amountCents: number | null; jobDate: string | null }[];
  invoices: { id: string; jobId: string; status: string; amountCents: number; sentAt: string | null; paidAt: string | null; hostedUrl: string | null }[];
  clientInvoices: { id: string; number: string | null; title: string | null; amountCents: number | null; issuedOn: string | null; paidOn: string | null }[];
  payments: { id: string; jobId: string | null; amountCents: number; method: string | null; receivedAt: string }[];
  sessions: { id: string; jobId: string; startsOn: string; endsOn: string | null; status: string; purpose: string | null }[];
  photos: { jobId: string; count: number }[];
  /** Calls with a call-back owed, from proposal calls. */
  callbacks: { outcome: string; note: string | null; callbackOn: string | null; createdAt: string }[];
  materials: MaterialFact[];
  slots: SlotFact[];
}

export const EMPTY_RAW: PersonRaw = {
  customer: null,
  properties: [],
  jobs: [],
  proposals: [],
  archivedProposals: [],
  invoices: [],
  clientInvoices: [],
  payments: [],
  sessions: [],
  photos: [],
  callbacks: [],
  materials: [],
  slots: [],
};

export type SectionId =
  | "contact"
  | "property"
  | "estimates"
  | "proposals"
  | "invoices"
  | "history"
  | "calendar"
  | "jobs"
  | "photos"
  | "notes"
  | "source"
  | "last"
  | "open";

export interface SectionItem {
  label: string;
  detail?: string | null;
  href?: string | null;
  tone?: "ok" | "wait" | "alert" | null;
}

export interface Section {
  id: SectionId;
  title: string;
  count: number;
  /** The app's own page for this kind of thing. */
  href: string | null;
  /** A line under the title: a balance, a total. */
  summary?: string | null;
  items: SectionItem[];
}

const dollars = (n: number | null | undefined) => (n == null ? null : Math.round(Number(n) * 100));
export { dollars as dollarsToCents };

const human = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "");
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/** Money owed: live invoices not paid, and uploaded invoices with no paid date. */
export function balanceOf(raw: PersonRaw): { paidCents: number; balanceCents: number } {
  const open = raw.invoices.filter((i) => i.status !== "paid" && i.status !== "void" && !i.paidAt).reduce((s, i) => s + i.amountCents, 0);
  const openUploaded = raw.clientInvoices.filter((i) => !i.paidOn).reduce((s, i) => s + (i.amountCents ?? 0), 0);
  return { paidCents: raw.payments.reduce((s, p) => s + p.amountCents, 0), balanceCents: open + openUploaded };
}

/** The facts Breakdown resolves from: the newest job and its proposal. */
export function factsFrom(raw: PersonRaw, name: string, today: string): PersonFacts {
  const job = [...raw.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const proposal = (job ? raw.proposals.find((p) => p.jobId === job.id) : null) ?? raw.proposals[0] ?? null;
  // The one still owed, else the latest that isn't void.
  const live = job ? raw.invoices.filter((i) => i.jobId === job.id && i.status !== "void") : [];
  const invoice = live.find((i) => !i.paidAt && i.status !== "paid") ?? live[0] ?? null;
  const { paidCents, balanceCents } = balanceOf(raw);
  return {
    name: raw.customer?.name || name,
    customerId: raw.customer?.id ?? null,
    address: raw.properties[0]?.address ?? null,
    jobId: job?.id ?? null,
    jobStatus: job?.status ?? null,
    proposal: proposal
      ? { id: proposal.id, jobId: proposal.jobId, token: proposal.token, status: proposal.status, totalCents: proposal.totalCents, paidAt: proposal.paidAt, paymentPath: proposal.paymentPath, zones: proposal.zones }
      : null,
    invoice: invoice ? { status: invoice.status, amountCents: invoice.amountCents, paidAt: invoice.paidAt, href: `/jobs/${invoice.jobId}` } : null,
    paidCents,
    balanceCents,
    slots: raw.slots,
    materials: raw.materials,
    upcoming: calendarOf(raw)
      .filter((c) => c.date >= today)
      .map((c) => ({ date: c.date, label: c.label })),
  };
}

function calendarOf(raw: PersonRaw): { date: string; label: string; jobId: string }[] {
  const out: { date: string; label: string; jobId: string }[] = [];
  for (const j of raw.jobs) {
    const what = j.name || (j.jobNumber ? `Job ${j.jobNumber}` : "Job");
    if (j.evaluationDate) out.push({ date: day(j.evaluationDate), label: `Evaluation visit · ${what}`, jobId: j.id });
    if (j.projectStartDate && !raw.sessions.some((s) => s.jobId === j.id)) out.push({ date: day(j.projectStartDate), label: `Work starts · ${what}`, jobId: j.id });
  }
  for (const s of raw.sessions) out.push({ date: day(s.startsOn), label: `${s.purpose ? human(s.purpose) : "Work day"} · ${human(s.status)}`, jobId: s.jobId });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const SHOWN = 6;

/**
 * The card's sections, in the order Jordan reads them. Each has a count and
 * a link to the app's own page for it. `extra` adds what only the board
 * knows: the question waiting on Jordan.
 */
export function buildSections(
  raw: PersonRaw,
  person: { name: string; phones: string[]; emails: string[]; handles: string[]; jobIds: string[]; messages: BoardMessage[] },
  today: string,
  extra: { question?: string | null } = {}
): Section[] {
  const c = raw.customer;
  const clientHref = c ? `/clients/${c.id}` : null;
  const jobId = raw.jobs[0]?.id ?? person.jobIds[0] ?? null;

  const phones = [...new Set([c?.phone, ...person.phones].filter((x): x is string => Boolean(x)))];
  const emails = [...new Set([c?.email, ...person.emails].filter((x): x is string => Boolean(x)))];
  const contactItems: SectionItem[] = [
    ...phones.map((p) => ({ label: "Phone", detail: p })),
    ...emails.map((e) => ({ label: "Email", detail: e })),
    ...person.handles.map((h) => ({ label: h.startsWith("ig:") ? "Instagram" : h.startsWith("fb:") ? "Facebook" : h.startsWith("google:") ? "Google" : "Handle", detail: h.replace(/^[a-z]+:/, "") })),
  ];
  if (c?.contactType) contactItems.push({ label: "Type", detail: human(c.contactType) });
  if (c?.doNotContact) contactItems.push({ label: "Do not contact", detail: "They asked not to be contacted", tone: "alert" });

  const estimates = raw.proposals.filter((p) => p.estimate);
  const { paidCents, balanceCents } = balanceOf(raw);
  const invoiceItems: SectionItem[] = [
    ...raw.invoices.map((i) => ({
      label: `Invoice · ${human(i.status)}`,
      detail: `${money(i.amountCents)}${i.paidAt ? ` · paid ${day(i.paidAt)}` : i.sentAt ? ` · sent ${day(i.sentAt)}` : ""}`,
      href: `/jobs/${i.jobId}`,
      tone: (i.paidAt || i.status === "paid" ? "ok" : "wait") as SectionItem["tone"],
    })),
    ...raw.clientInvoices.map((i) => ({
      label: `Invoice${i.number ? ` #${i.number}` : ""}${i.title ? ` · ${i.title}` : ""}`,
      detail: `${i.amountCents != null ? money(i.amountCents) : "no amount"}${i.paidOn ? ` · paid ${i.paidOn}` : i.issuedOn ? ` · issued ${i.issuedOn}` : ""}`,
      href: clientHref,
      tone: (i.paidOn ? "ok" : "wait") as SectionItem["tone"],
    })),
    ...raw.payments.map((p) => ({ label: `Payment${p.method ? ` · ${human(p.method)}` : ""}`, detail: `${money(p.amountCents)} · ${day(p.receivedAt)}`, href: p.jobId ? `/jobs/${p.jobId}` : clientHref, tone: "ok" as const })),
  ];

  const messages = [...person.messages].reverse();
  const check = replyCheck(person.messages);
  const cal = calendarOf(raw);
  const upcoming = cal.filter((x) => x.date >= today);
  const past = cal.filter((x) => x.date < today).reverse();
  const photoCount = raw.photos.reduce((s, p) => s + p.count, 0);

  const notes: SectionItem[] = [];
  if (c?.notes) notes.push({ label: "Contact note", detail: c.notes });
  if (c?.tags?.length) notes.push({ label: "Tags", detail: c.tags.join(", ") });
  for (const p of raw.properties) if (p.notes) notes.push({ label: "Property note", detail: p.notes });
  for (const j of raw.jobs) if (j.clientNotes) notes.push({ label: "They wrote when booking", detail: j.clientNotes, href: `/jobs/${j.id}` });

  const source: SectionItem[] = [];
  if (c?.source) source.push({ label: "Lead source", detail: human(c.source) });
  for (const j of raw.jobs) if (j.heardAbout) source.push({ label: "Heard about us", detail: human(j.heardAbout), href: `/jobs/${j.id}` });
  const firstMsg = person.messages[0];
  if (firstMsg) source.push({ label: "First reached us", detail: `${CHANNELS[firstMsg.channel].label} · ${day(firstMsg.at)}` });
  if (c?.createdAt) source.push({ label: "Contact since", detail: day(c.createdAt) });

  const open: SectionItem[] = [];
  if (extra.question) open.push({ label: "Waiting on you", detail: extra.question, tone: "alert" });
  if (check.unread.length) open.push({ label: "Unanswered", detail: `${check.unread.length} message${check.unread.length === 1 ? "" : "s"} from them`, tone: "wait" });
  for (const cb of raw.callbacks) open.push({ label: `Call back${cb.callbackOn ? ` by ${cb.callbackOn}` : ""}`, detail: cb.note || human(cb.outcome), tone: cb.callbackOn && cb.callbackOn < today ? "alert" : "wait" });
  if (balanceCents > 0) open.push({ label: "Balance owed", detail: money(balanceCents), tone: "wait" });

  return [
    { id: "contact", title: "Contact", count: contactItems.length, href: clientHref, items: contactItems },
    {
      id: "property",
      title: "Property",
      count: raw.properties.length,
      href: clientHref,
      items: raw.properties.map((p) => ({
        label: p.address,
        detail: [p.sqft ? `${Math.round(p.sqft).toLocaleString()} sq ft house` : null, p.acreage ? `${p.acreage} acres` : null].filter(Boolean).join(" · ") || null,
        href: clientHref,
      })),
    },
    {
      id: "estimates",
      title: "Estimates",
      count: estimates.length,
      href: estimates[0] ? `/jobs/${estimates[0].jobId}/pricing-report` : null,
      items: estimates.map((p) => ({
        label: `Estimate${p.totalCents != null ? ` · ${money(p.totalCents)}` : ""}`,
        detail: `${p.estimate!.crew} crew, ${p.estimate!.days} day${p.estimate!.days === 1 ? "" : "s"}, ${p.estimate!.billedHours} h billed${p.estimate!.materialsCents != null ? `, materials ${money(p.estimate!.materialsCents)}` : ""}`,
        href: `/jobs/${p.jobId}/pricing-report`,
      })),
    },
    {
      id: "proposals",
      title: "Proposals",
      count: raw.proposals.length + raw.archivedProposals.length,
      href: "/proposals",
      items: [
        ...raw.proposals.map((p) => ({
          label: `Proposal · ${human(p.status)}${p.totalCents != null ? ` · ${money(p.totalCents)}` : ""}`,
          detail: [`${p.zones.length} area${p.zones.length === 1 ? "" : "s"}`, p.sentAt ? `sent ${day(p.sentAt)}` : null, p.paidAt ? `paid ${day(p.paidAt)}` : null].filter(Boolean).join(" · "),
          href: `/proposal/${p.token}`,
          tone: (p.paidAt ? "ok" : p.status === "sent" ? "wait" : null) as SectionItem["tone"],
        })),
        ...raw.archivedProposals.map((a) => ({
          label: `Older proposal${a.title ? ` · ${a.title}` : ""}`,
          detail: [a.amountCents != null ? money(a.amountCents) : null, a.outcome ? human(a.outcome) : null, a.jobDate].filter(Boolean).join(" · "),
          href: clientHref,
        })),
      ],
    },
    {
      id: "invoices",
      title: "Invoices and payments",
      count: raw.invoices.length + raw.clientInvoices.length + raw.payments.length,
      href: jobId ? `/jobs/${jobId}` : clientHref,
      summary: `Paid ${money(paidCents)} · Balance ${money(balanceCents)}`,
      items: invoiceItems,
    },
    {
      id: "history",
      title: "Every message, all channels",
      count: person.messages.length,
      href: jobId ? `/conversations/job/${jobId}` : "/conversations",
      items: messages.slice(0, 20).map((m) => ({
        label: `${CHANNELS[m.channel].label} · ${m.direction === "in" ? "them" : "us"}`,
        detail: `${m.text} (${m.at.slice(0, 16).replace("T", " ")})`,
      })),
    },
    {
      id: "calendar",
      title: "Calendar",
      count: cal.length,
      href: "/evaluations",
      summary: `${upcoming.length} upcoming · ${past.length} past`,
      items: [
        ...upcoming.map((x) => ({ label: `Upcoming · ${x.date}`, detail: x.label, href: `/jobs/${x.jobId}`, tone: "wait" as const })),
        ...past.slice(0, SHOWN).map((x) => ({ label: `Past · ${x.date}`, detail: x.label, href: `/jobs/${x.jobId}` })),
      ],
    },
    {
      id: "jobs",
      title: "Jobs",
      count: raw.jobs.length,
      href: clientHref,
      items: raw.jobs.map((j) => ({
        label: j.name || (j.jobNumber ? `Job ${j.jobNumber}` : "Job"),
        detail: `${human(j.status)} · since ${day(j.createdAt)}${j.completedAt ? ` · done ${day(j.completedAt)}` : ""}`,
        href: `/jobs/${j.id}`,
        tone: (j.completedAt ? "ok" : null) as SectionItem["tone"],
      })),
    },
    {
      id: "photos",
      title: "Photos and site maps",
      count: photoCount,
      href: jobId ? `/jobs/${jobId}/photos` : null,
      items: raw.jobs.flatMap((j) => {
        const n = raw.photos.find((p) => p.jobId === j.id)?.count ?? 0;
        return [
          ...(n ? [{ label: `${n} photo${n === 1 ? "" : "s"}`, detail: j.name || "Job", href: `/jobs/${j.id}/photos` }] : []),
          { label: "Site map", detail: j.name || "Job", href: `/jobs/${j.id}/site-map` },
        ];
      }),
    },
    { id: "notes", title: "Notes and tags", count: notes.length, href: clientHref, items: notes },
    { id: "source", title: "Lead source", count: source.length, href: clientHref, items: source },
    {
      id: "last",
      title: "Last time we talked",
      count: check.lastOut ? 1 : 0,
      href: jobId ? `/conversations/job/${jobId}` : "/conversations",
      items: [
        check.lastOut ? { label: `Us · ${CHANNELS[check.lastOut.channel].label}`, detail: `${day(check.lastOut.at)}: ${check.lastOut.text}` } : { label: "Us", detail: "We haven't replied yet", tone: "wait" as const },
        ...(check.lastIn ? [{ label: `Them · ${CHANNELS[check.lastIn.channel].label}`, detail: `${day(check.lastIn.at)}: ${check.lastIn.text}` }] : []),
      ],
    },
    { id: "open", title: "Open questions and tasks", count: open.length, href: null, items: open },
  ];
}
