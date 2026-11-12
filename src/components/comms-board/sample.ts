/**
 * Made-up people for /review/comms-board. Nobody here is a real client:
 * every name is invented, every email is at example.com and every number is
 * a 555 number. The board runs on them through the same pure code as the
 * live page, and saves and sends nothing.
 */

import { type BoardMessage, type CardState, type ChannelId } from "@/lib/comms-board";
import { resolveIntent, type IntentHint, type MaterialFact, type SlotFact, type ZoneFact } from "@/lib/comms-intents";
import { factsFrom, type PersonRaw } from "@/lib/comms-person";

export const SAMPLE_TODAY = "2026-11-09";

type Spec = {
  key: string;
  handle?: string;
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string;
  town: string;
  source: string;
  notes: string;
  tags: string[];
  contactType?: string;
  /** Earlier finished job. */
  past: { name: string; cents: number; on: string } | null;
  /** The current job. */
  current: { name: string; status: string; evalOn: string; startOn?: string | null } | null;
  proposal?: { status: string; zones: ZoneFact[]; sentAt: string; paidAt?: string | null; paymentPath?: string | null; crew: number; days: number; hours: number; materialsCents: number } | null;
  invoices?: { status: string; cents: number; sentAt: string; paidAt?: string | null }[];
  payments?: { cents: number; method: string; on: string }[];
  callbacks?: { note: string; on: string }[];
  materials?: MaterialFact[];
  slots?: SlotFact[];
  photos?: number;
};

const total = (zones: ZoneFact[]) => zones.reduce((s, z) => s + (z.priceCents ?? 0), 0);

function raw(p: Spec): PersonRaw {
  const pastJob = p.past ? { id: `${p.id}-j0`, name: p.past.name, jobNumber: `${1100 + p.id.length * 7}`, status: "completed", createdAt: `${p.past.on}T12:00:00Z`, evaluationDate: `${p.past.on}T14:00:00Z`, projectStartDate: p.past.on, projectEndDate: p.past.on, completedAt: `${p.past.on}T20:00:00Z`, heardAbout: p.source, clientNotes: null } : null;
  const curJob = p.current
    ? { id: `${p.id}-j1`, name: p.current.name, jobNumber: `${1200 + p.id.length * 3}`, status: p.current.status, createdAt: `${p.current.evalOn}T12:00:00Z`, evaluationDate: `${p.current.evalOn}T15:00:00Z`, projectStartDate: p.current.startOn ?? null, projectEndDate: null, completedAt: null, heardAbout: p.source, clientNotes: "Side gate is unlocked. Dog is friendly." }
    : null;
  const jobs = [curJob, pastJob].filter((j): j is NonNullable<typeof j> => Boolean(j));
  const prop = p.proposal && curJob ? p.proposal : null;
  return {
    customer: { id: p.id, name: p.name, phone: p.phone, email: p.email, notes: p.notes, tags: p.tags, source: p.source, contactType: p.contactType ?? "client", doNotContact: false, createdAt: "2025-03-14T12:00:00Z" },
    properties: [{ id: `${p.id}-pr`, address: `${p.address}, ${p.town}, MD`, sqft: 2150, acreage: 0.38, notes: "Corner lot. Irrigation heads along the front walk." }],
    jobs,
    proposals: prop
      ? [
          {
            id: `${p.id}-p1`,
            jobId: curJob!.id,
            token: `sample-${p.id}`,
            status: prop.status,
            totalCents: total(prop.zones),
            sentAt: prop.sentAt,
            paidAt: prop.paidAt ?? null,
            paymentPath: prop.paymentPath ?? null,
            estimate: { crew: prop.crew, days: prop.days, billedHours: prop.hours, materialsCents: prop.materialsCents },
            zones: prop.zones,
          },
        ]
      : [],
    archivedProposals: pastJob ? [{ id: `${p.id}-a1`, title: "Patio refresh (2024)", outcome: "declined", amountCents: 420000, jobDate: "2024-05-02" }] : [],
    invoices: [
      ...(pastJob ? [{ id: `${p.id}-i0`, jobId: pastJob.id, status: "paid", amountCents: p.past!.cents, sentAt: `${p.past!.on}T21:00:00Z`, paidAt: `${p.past!.on}T23:00:00Z`, hostedUrl: null }] : []),
      ...(p.invoices ?? []).map((i, n) => ({ id: `${p.id}-i${n + 1}`, jobId: curJob?.id ?? pastJob?.id ?? "", status: i.status, amountCents: i.cents, sentAt: `${i.sentAt}T14:00:00Z`, paidAt: i.paidAt ? `${i.paidAt}T14:00:00Z` : null, hostedUrl: null })),
    ],
    clientInvoices: pastJob ? [{ id: `${p.id}-ci`, number: `${2200 + p.id.length}`, title: "Fall leaf cleanup 2025", amountCents: 32000, issuedOn: "2025-11-20", paidOn: "2025-11-28" }] : [],
    payments: [
      ...(pastJob ? [{ id: `${p.id}-pay0`, jobId: pastJob.id, amountCents: p.past!.cents, method: "card", receivedAt: `${p.past!.on}T23:00:00Z` }] : []),
      ...(p.payments ?? []).map((x, n) => ({ id: `${p.id}-pay${n + 1}`, jobId: curJob?.id ?? null, amountCents: x.cents, method: x.method, receivedAt: `${x.on}T15:00:00Z` })),
    ],
    sessions: [
      ...(pastJob ? [{ id: `${p.id}-s0`, jobId: pastJob.id, startsOn: p.past!.on, endsOn: p.past!.on, status: "done", purpose: "work" }] : []),
      ...(curJob?.projectStartDate ? [{ id: `${p.id}-s1`, jobId: curJob.id, startsOn: curJob.projectStartDate, endsOn: null, status: "scheduled", purpose: "work" }] : []),
    ],
    photos: [...(curJob ? [{ jobId: curJob.id, count: p.photos ?? 9 }] : []), ...(pastJob ? [{ jobId: pastJob.id, count: 14 }] : [])],
    callbacks: (p.callbacks ?? []).map((c) => ({ outcome: "callback", note: c.note, callbackOn: c.on, createdAt: "2026-11-02T14:00:00Z" })),
    materials: p.materials ?? [],
    slots: p.slots ?? [],
  };
}

const m = (id: string, channel: ChannelId, direction: "in" | "out", at: string, text: string, who: { id?: string; name: string; phone?: string | null; email?: string | null; handle?: string | null }): BoardMessage => ({
  id,
  channel,
  direction,
  at,
  text,
  name: who.name,
  customerId: who.id ?? null,
  phone: who.phone ?? null,
  email: who.email ?? null,
  handle: who.handle ?? null,
  jobId: who.id ? `${who.id}-j1` : null,
});

const DANA = { id: "s-dana", name: "Dana Whitfield", phone: "(410) 555-0142", email: "dana.w@example.com" };
const MARCUS = { id: "s-marcus", name: "Marcus Bell", phone: "(443) 555-0118", email: "marcus.bell@example.com" };
const ROMANO = { id: "s-romano", name: "Pat & Lou Romano", phone: "(410) 555-0177", email: "romanos@example.com" };
const CLUB = { id: "s-club", name: "Harford Garden Club", phone: "(410) 555-0160", email: "garden.club@example.com" };
const KIM = { id: "s-kim", name: "Kim Osei", phone: "(410) 555-0193", email: "kosei@example.com" };
const JEN = { id: "s-jen", name: "Jen Park (@chesapeakeyards)", phone: "(443) 555-0150", email: "jen.park@example.com", handle: "ig:chesapeakeyards" };
const ROB = { id: "s-rob", name: "Rob Tierney", phone: "(443) 555-0105", email: "rob.t@example.com" };
const TANYA = { id: "s-tanya", name: "Tanya Greer", phone: "(410) 555-0126", email: "tgreer@example.com" };
const SEO = { id: "s-seo", name: "Peak Rank SEO", phone: null, email: "sales@peakrank.example.com" };
const GENE = { id: "s-gene", name: "Gene Albright", phone: "(443) 555-0133", email: "gene.a@example.com" };

const DANA_ZONES: ZoneFact[] = [
  { name: "Front beds", service: "Mulch", scope: "3 yd black hardwood mulch, edge and weed", priceCents: 86000 },
  { name: "Back slope", service: "Planting", scope: "12 shrubs (inkberry holly), 3 gal, with fabric", priceCents: 154000 },
  { name: "Walkway", service: "Edging", scope: "60 ft steel edging along the front walk", priceCents: 38000 },
];
const MARCUS_ZONES: ZoneFact[] = [
  { name: "Front beds", service: "Mulch", scope: "6 yd black hardwood mulch, edge and weed", priceCents: 115000 },
  { name: "Side yard", service: "Edging", scope: "80 ft steel edging, side and front", priceCents: 90000 },
  { name: "Back fence line", service: "Planting", scope: "8 boxwoods 'Green Velvet', 3 gal", priceCents: 140000 },
];

export const SAMPLE_RAW: Record<string, PersonRaw> = {
  "c:s-dana": raw({
    key: "c:s-dana", ...DANA, address: "14 Laurel Ct", town: "Bel Air", source: "google", notes: "Prefers texts after 5pm.", tags: ["repeat", "mulch every spring"],
    past: { name: "Spring mulch 2026", cents: 86000, on: "2026-04-20" },
    current: { name: "Fall planting", status: "proposal_sent", evalOn: "2026-10-24" },
    proposal: { status: "sent", zones: DANA_ZONES, sentAt: "2026-10-30T15:00:00Z", crew: 3, days: 2, hours: 22, materialsCents: 64000 },
    callbacks: [{ note: "Wants a walk-through of the back slope", on: "2026-11-12" }],
    photos: 11,
  }),
  "c:s-marcus": raw({
    key: "c:s-marcus", ...MARCUS, address: "203 Philadelphia Rd", town: "Abingdon", source: "instagram", notes: "Found us from the edging reel.", tags: ["new client"],
    past: null,
    current: { name: "Mulch, edging and boxwoods", status: "accepted", evalOn: "2026-11-03" },
    proposal: { status: "accepted", zones: MARCUS_ZONES, sentAt: "2026-11-05T16:00:00Z", paidAt: "2026-11-08T22:10:00Z", paymentPath: "plan", crew: 2, days: 2, hours: 18, materialsCents: 98000 },
    invoices: [{ status: "paid", cents: 115000, sentAt: "2026-11-08", paidAt: "2026-11-08" }, { status: "open", cents: 230000, sentAt: "2026-11-08" }],
    payments: [{ cents: 115000, method: "card", on: "2026-11-08" }],
    materials: [
      { name: "Black hardwood mulch", quantity: "6 yd", toOrder: "6 yd" },
      { name: "Steel edging", quantity: "80 ft", toOrder: "40 ft" },
      { name: "Boxwood 'Green Velvet' 3 gal", quantity: "8", toOrder: "8" },
      { name: "Landscape fabric", quantity: "2 rolls", toOrder: null },
    ],
    slots: [
      { date: "2026-11-17", crewNames: ["Luis R.", "Sam T."], crewProfileIds: ["crew-1", "crew-2"], because: ["Two other jobs in Abingdon that day"] },
      { date: "2026-11-19", crewNames: ["Luis R.", "Dee M."], crewProfileIds: ["crew-1", "crew-3"], because: ["Open all day, dry forecast"] },
      { date: "2026-11-23", crewNames: ["Sam T.", "Dee M."], crewProfileIds: ["crew-2", "crew-3"], because: ["Open, but 40 minutes from the next job"] },
    ],
    photos: 7,
  }),
  "c:s-romano": raw({ key: "c:s-romano", ...ROMANO, address: "9 Mountain Rd", town: "Fallston", source: "referral", notes: "Lou does the talking. Call, don't text.", tags: ["prefers phone"], past: { name: "Rock bed by the drive", cents: 124000, on: "2025-09-12" }, current: { name: "Patio beds", status: "proposal_sent", evalOn: "2026-10-27" }, proposal: { status: "sent", zones: [{ name: "Patio beds", service: "Planting", scope: "2 beds, perennials and mulch", priceCents: 210000 }], sentAt: "2026-10-30T15:00:00Z", crew: 2, days: 1, hours: 10, materialsCents: 72000 } }),
  "c:s-club": raw({ key: "c:s-club", ...CLUB, address: "100 E Pennsylvania Ave", town: "Bel Air", source: "letter", notes: "Community group. Spring planting at the library.", tags: ["community"], contactType: "other", past: { name: "Library mulch donation 2025", cents: 0, on: "2025-04-12" }, current: null }),
  "c:s-kim": raw({ key: "c:s-kim", ...KIM, address: "48 Hanson Rd", town: "Edgewood", source: "website", notes: "Townhouse, HOA rules on edging.", tags: ["HOA"], past: null, current: { name: "Bed refresh and edging", status: "completed", evalOn: "2026-10-14", startOn: "2026-10-28" }, proposal: { status: "accepted", zones: [{ name: "Front bed", service: "Mulch", scope: "Refresh, 1.5 yd", priceCents: 34000 }, { name: "Front walk", service: "Edging", scope: "30 ft steel edging", priceCents: 20000 }], sentAt: "2026-10-16T15:00:00Z", paidAt: "2026-10-29T15:00:00Z", paymentPath: "full", crew: 2, days: 1, hours: 6, materialsCents: 18000 }, invoices: [{ status: "paid", cents: 54000, sentAt: "2026-10-28", paidAt: "2026-10-29" }], payments: [{ cents: 54000, method: "card", on: "2026-10-29" }], callbacks: [{ note: "Check on the shrub warranty", on: "2026-11-07" }] }),
  "c:s-jen": raw({ key: "c:s-jen", ...JEN, address: "7 Tollgate Rd", town: "Bel Air", source: "instagram", notes: "Posts our work. Happy to be tagged.", tags: ["fan", "social"], past: { name: "Front bed edging", cents: 62000, on: "2026-10-30" }, current: null }),
  "c:s-rob": raw({ key: "c:s-rob", ...ROB, address: "320 Joppa Farm Rd", town: "Joppa", source: "nextdoor", notes: "Large lot. Leaf cleanup every fall.", tags: ["repeat", "leaf cleanup"], past: { name: "Leaf cleanup 2026", cents: 48000, on: "2026-11-05" }, current: null }),
  "c:s-tanya": raw({ key: "c:s-tanya", ...TANYA, address: "61 Grafton Shop Rd", town: "Forest Hill", source: "website", notes: "Booked online.", tags: ["new lead"], past: null, current: { name: "Mulch quote", status: "lead", evalOn: "2026-11-12" } }),
  "c:s-seo": raw({ key: "c:s-seo", ...SEO, address: "Unknown", town: "Remote", source: "email", notes: "Vendor. Sends SEO pitches.", tags: ["vendor"], contactType: "supplier", past: null, current: null }),
  "c:s-gene": raw({ key: "c:s-gene", ...GENE, address: "12 Old Post Rd", town: "Aberdeen", source: "flyer", notes: "Saw the door hanger.", tags: ["door hanger"], past: { name: "Hedge trim 2025", cents: 26000, on: "2025-06-18" }, current: null }),
};

export const SAMPLE_MESSAGES: BoardMessage[] = [
  m("d1", "sms", "out", "2026-10-30T15:05:00Z", "Hi Dana, your fall planting proposal is ready: front beds, the back slope and the walkway edging.", DANA),
  m("d2", "sms", "in", "2026-11-08T22:40:00Z", "Thanks! Can you adjust my proposal? The back slope planting is more than we budgeted. Could you do it for $1,300?", DANA),
  m("d3", "email", "in", "2026-11-09T14:12:00Z", "Also, if we go ahead we'd love the front beds done before Thanksgiving.", DANA),

  m("mb1", "ig_dm", "in", "2026-11-03T13:44:00Z", "How much for mulch + edging like your reel? Abingdon", { ...MARCUS, handle: "ig:marcusbell" }),
  m("mb2", "sms", "out", "2026-11-05T16:02:00Z", "Hi Marcus, here's your proposal for the front beds, side yard edging and boxwoods.", MARCUS),
  m("mb3", "app", "in", "2026-11-08T22:10:00Z", "Accepted. Paid the deposit.", MARCUS),
  m("mb4", "sms", "in", "2026-11-09T13:40:00Z", "Just accepted the proposal and paid the deposit! When can you start?", MARCUS),

  m("r1", "call", "in", "2026-11-08T19:20:00Z", "Incoming call from Lou Romano. Missed, 0:42.", ROMANO),
  m("r2", "voicemail", "in", "2026-11-08T19:21:00Z", "Hey it's Lou, calling about the proposal you sent. Give us a call back.", ROMANO),

  m("gc1", "mail", "in", "2026-11-06T15:00:00Z", "Letter asking if we'd donate mulch for the spring library planting again.", CLUB),

  m("k1", "sms", "out", "2026-10-28T21:00:00Z", "All done for today, Kim! Photos are on your page.", KIM),
  m("k2", "email", "in", "2026-11-07T14:30:00Z", "The crew left the new edging crooked along the walk and one of the shrubs is already dead.", KIM),

  m("j1", "ig_mention", "in", "2026-11-07T17:00:00Z", "Shoutout @jslandscapingmd for the clean edges on this one #harfordcounty", JEN),
  m("j2", "ig_mention", "out", "2026-11-07T18:00:00Z", "Thanks for the shoutout, Jen! It was a fun one.", JEN),

  m("rt1", "google", "in", "2026-11-07T12:00:00Z", "★★★★★ Showed up when they said, left the place spotless.", ROB),
  m("rt2", "google", "out", "2026-11-07T15:00:00Z", "Thank you, Rob! It was a pleasure. See you in the spring.", ROB),

  m("t1", "form", "in", "2026-11-09T12:30:00Z", "Need a quote for 6 yards of mulch, front and side beds.", TANYA),

  m("seo1", "email", "in", "2026-11-08T09:00:00Z", "We offer SEO services to rank your business #1 on Google. Reply for pricing.", SEO),

  m("g1", "call", "in", "2026-11-09T15:05:00Z", "Missed call, 0:38, no voicemail.", GENE),
];

/** What Claude would say for these sample people; the rest fall back to keywords. */
export const SAMPLE_HINTS: Record<string, IntentHint> = {
  "c:s-dana": { intent: "proposal_change", summary: "Lower the back slope planting to $1,300, and front beds before Thanksgiving", zoneName: "Back slope", change: "price", newPriceCents: 130000 },
  "c:s-marcus": { intent: "proposal_accepted", summary: "Accepted and paid the deposit, wants a start date", slotDate: "2026-11-17" },
  "c:s-kim": { intent: "issue", summary: "Edging crooked along the walk and a dead shrub" },
  "c:s-tanya": { intent: "quote_request", summary: "Quote for 6 yards of mulch, front and side beds" },
  "c:s-seo": { intent: "not_client", summary: "SEO sales pitch" },
};

function prepared(key: string, lane: CardState["lane"], basedOn: string, updatedAt: string, extra: Partial<CardState> = {}): CardState {
  const hint = SAMPLE_HINTS[key];
  const r = SAMPLE_RAW[key];
  const b = resolveIntent({ facts: factsFrom(r, r.customer?.name ?? "", SAMPLE_TODAY), hint, said: [], today: SAMPLE_TODAY });
  return {
    personKey: key,
    lane,
    intent: b.intent,
    intentSummary: b.summary,
    resources: b.resources,
    action: b.action,
    question: b.question,
    draft: b.question ? null : b.message,
    draftChannel: "sms",
    draftByHand: false,
    basedOn,
    noReasons: [],
    updatedAt,
    ...extra,
  };
}

export function sampleStates(): CardState[] {
  return [
    prepared("c:s-dana", "validate", "2026-11-09T14:12:00Z", "2026-11-09T14:20:00Z", { draftChannel: "email" }),
    prepared("c:s-marcus", "doing", "2026-11-09T13:40:00Z", "2026-11-09T14:30:00Z"),
    prepared("c:s-kim", "track", "2026-11-07T14:30:00Z", "2026-11-07T15:00:00Z", { draftChannel: "email" }),
    { personKey: "c:s-tanya", lane: "breakdown", basedOn: null, updatedAt: "2026-11-09T12:31:00Z" },
    { personKey: "c:s-jen", lane: "done", sent: { body: "Thanks for the shoutout, Jen! It was a fun one.", channel: "ig_mention", at: "2026-11-07T18:00:00Z", byHand: true } },
    { personKey: "c:s-rob", lane: "done", sent: { body: "Thank you, Rob! It was a pleasure. See you in the spring.", channel: "google", at: "2026-11-07T15:00:00Z", byHand: false } },
    prepared("c:s-seo", "done", "2026-11-08T09:00:00Z", "2026-11-08T09:30:00Z", { sent: { body: "", channel: "other", at: "2026-11-08T09:30:00Z", byHand: false, did: "Don't reply. File it as done." } }),
  ];
}
