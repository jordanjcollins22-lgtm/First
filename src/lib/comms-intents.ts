/**
 * Breakdown: what the person wants, what the validator needs to see to
 * decide, the action we recommend, and the words to send.
 *
 * Claude names the intent (structured output, lib/actions/comms-board-actions.ts);
 * `keywordIntent` is the fallback when there is no model. Each intent has a
 * resolver here that turns the person's facts (lib/data/comms-person.ts) into
 * resources, an action and, when it cannot recommend anything without
 * Jordan, a question with tap-to-answer options. Pure and tested.
 */

export type IntentId =
  | "proposal_change"
  | "proposal_accepted"
  | "quote_request"
  | "schedule"
  | "issue"
  | "payment"
  | "thanks"
  | "question"
  | "not_client";

export const INTENTS: Record<IntentId, string> = {
  proposal_change: "Change to their proposal",
  proposal_accepted: "Accepted and paid: book it",
  quote_request: "New quote request",
  schedule: "Schedule or reschedule",
  issue: "Complaint or issue",
  payment: "Payment or invoice question",
  thanks: "Review or mention: thank them",
  question: "General question",
  not_client: "Not a client (spam or vendor)",
};

export const INTENT_IDS = Object.keys(INTENTS) as IntentId[];

export function isIntent(v: unknown): v is IntentId {
  return typeof v === "string" && v in INTENTS;
}

/** Something to look at before deciding: a link into the app, and the part that matters. */
export interface Resource {
  label: string;
  href: string;
  /** The line or area to look at, shown highlighted. */
  highlight?: string | null;
  /** Supporting lines: a materials list, open days, payments. */
  lines?: string[];
}

export type CardAction =
  | { kind: "send"; label: string }
  | { kind: "no_reply"; label: string }
  | {
      kind: "proposal_price";
      label: string;
      jobId: string;
      zoneName: string;
      fromCents: number;
      toCents: number;
      newTotalCents: number;
    }
  | { kind: "proposal_remove"; label: string; proposalId: string; zoneName: string; newTotalCents: number }
  | { kind: "book"; label: string; jobId: string; date: string; crewProfileIds: string[]; crewNames: string[]; because: string[] };

export interface Question {
  text: string;
  /** Tap to answer. "Other" with typed text is always offered as well. */
  options: string[];
}

// ---------------------------------------------------------------------------
// Facts about one person, as the resolvers need them
// ---------------------------------------------------------------------------

export interface ZoneFact {
  name: string;
  service: string;
  scope: string;
  priceCents: number | null;
}

export interface ProposalFact {
  id: string;
  jobId: string;
  token: string;
  status: string;
  totalCents: number | null;
  paidAt: string | null;
  paymentPath: string | null;
  zones: ZoneFact[];
}

export interface SlotFact {
  date: string;
  crewNames: string[];
  crewProfileIds: string[];
  because: string[];
}

export interface MaterialFact {
  name: string;
  quantity: string;
  /** What still has to be bought, when purchasing has worked it out. */
  toOrder: string | null;
}

export interface PersonFacts {
  name: string;
  customerId: string | null;
  address: string | null;
  jobId: string | null;
  jobStatus: string | null;
  proposal: ProposalFact | null;
  invoice: { status: string; amountCents: number; paidAt: string | null; href: string } | null;
  paidCents: number;
  balanceCents: number;
  slots: SlotFact[];
  materials: MaterialFact[];
  upcoming: { date: string; label: string }[];
}

export const NO_FACTS: PersonFacts = {
  name: "",
  customerId: null,
  address: null,
  jobId: null,
  jobStatus: null,
  proposal: null,
  invoice: null,
  paidCents: 0,
  balanceCents: 0,
  slots: [],
  materials: [],
  upcoming: [],
};

export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function firstName(name: string): string {
  const w = name.replace(/^@/, "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'-]*$/.test(w) ? w : "there";
}

/** "2026-11-17" as "Tue Nov 17". */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// The intent, without a model
// ---------------------------------------------------------------------------

/** Their words, newest last, and the channel of the newest. */
export function keywordIntent(texts: string[], channel?: string): IntentId {
  const t = texts.join(" \n ").toLowerCase();
  if (/\b(seo|backlinks?|marketing services|guest post|crypto|loan offer|wholesale|we sell|vendor|partnership opportunity|rank your (site|business))\b/.test(t)) return "not_client";
  if (/\b(accept(ed)?|approved|signed|went ahead)\b/.test(t) && /\b(paid|deposit|payment)\b/.test(t)) return "proposal_accepted";
  if (/\b(accept(ed)?|approved|signed)\b.*\b(proposal|quote|estimate)\b/.test(t)) return "proposal_accepted";
  if (/\b(proposal|quote|estimate)\b/.test(t) && /\b(change|adjust|remove|drop|take (off|out)|lower|cheaper|instead|swap|skip|less|without)\b/.test(t)) return "proposal_change";
  if (/\b(invoice|bill(ed)?|charged?|refund|receipt|balance|card declined|payment)\b/.test(t)) return "payment";
  if (/\b(complain\w*|unhappy|disappoint\w*|damaged?|broke|didn'?t show|no show|problem|issue|not happy|dead|mess)\b/.test(t)) return "issue";
  if (/\b(reschedul\w*|what (day|time)|when (are|will|can) you|move (the|our)|push (it|back)|next week|monday|tuesday|wednesday|thursday|friday|saturday|time works)\b/.test(t)) return "schedule";
  if (/\b(quote|estimate|how much|price for|pricing|cost|interested in|looking for|need (a|some))\b/.test(t)) return "quote_request";
  if (channel === "google" || /mention|comment/.test(channel ?? "") || /\b(thank|thanks|great job|awesome|shout ?out|love (it|the))\b|★/.test(t)) return "thanks";
  return "question";
}

// ---------------------------------------------------------------------------
// What Claude says back, read safely
// ---------------------------------------------------------------------------

/** What the breakdown model returns. Every field is checked against the facts. */
export interface IntentHint {
  intent: IntentId;
  summary: string;
  zoneName?: string | null;
  change?: "price" | "remove" | null;
  newPriceCents?: number | null;
  slotDate?: string | null;
}

export function breakdownSchema(zoneNames: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["intent", "summary", "zone_name", "change", "new_price_dollars", "slot_date"],
    properties: {
      intent: { type: "string", enum: INTENT_IDS },
      summary: { type: "string", description: "What they want, in one short sentence." },
      zone_name: { type: ["string", "null"], enum: [...zoneNames, null], description: "The proposal area they mean, if any." },
      change: { type: ["string", "null"], enum: ["price", "remove", null] },
      new_price_dollars: { type: ["number", "null"], description: "Only a price they asked for or agreed to, never invented." },
      slot_date: { type: ["string", "null"], description: "YYYY-MM-DD, only one of the open days given." },
    },
  } as const;
}

export function parseHint(raw: string, zoneNames: string[], slotDates: string[]): IntentHint | null {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!isIntent(d.intent)) return null;
    const price = typeof d.new_price_dollars === "number" && d.new_price_dollars > 0 && d.new_price_dollars < 1_000_000 ? Math.round(d.new_price_dollars * 100) : null;
    return {
      intent: d.intent,
      summary: typeof d.summary === "string" ? d.summary.slice(0, 200) : INTENTS[d.intent],
      zoneName: typeof d.zone_name === "string" && zoneNames.includes(d.zone_name) ? d.zone_name : null,
      change: d.change === "price" || d.change === "remove" ? d.change : null,
      newPriceCents: price,
      slotDate: typeof d.slot_date === "string" && slotDates.includes(d.slot_date) ? d.slot_date : null,
    };
  } catch {
    return null;
  }
}

/** A dollar figure in some words: "$450", "450 dollars". */
export function dollarsIn(text: string): number | null {
  const m = text.replace(/,/g, "").match(/\$\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?dollars/i);
  const n = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** The proposal area their words name, by area name or service. */
export function zoneNamed(text: string, zones: ZoneFact[]): ZoneFact | null {
  const t = text.toLowerCase();
  return (
    zones.find((z) => z.name && t.includes(z.name.toLowerCase())) ??
    zones.find((z) => z.service && t.includes(z.service.toLowerCase())) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export interface Breakdown {
  intent: IntentId;
  summary: string;
  resources: Resource[];
  action: CardAction;
  /** Set when Jordan has to answer before anything can be recommended: the card waits in Answer · Track. */
  question: Question | null;
  /** The message written from the facts alone; Claude's draft replaces it when there is a model. */
  message: string;
}

export interface ResolveInput {
  facts: PersonFacts;
  hint: IntentHint;
  /** Their unanswered words, oldest first. */
  said: string[];
  /** Jordan's answer to the card's question, if he gave one. */
  answer?: string | null;
  /** For the "which week" options. */
  today: string;
}

type Resolver = (input: ResolveInput) => Omit<Breakdown, "intent" | "summary">;

const send = (label = "Send the message"): CardAction => ({ kind: "send", label });

function proposalResource(p: ProposalFact, zone?: ZoneFact | null, change?: string): Resource {
  return {
    label: `Proposal · ${p.status.replace(/_/g, " ")} · ${p.totalCents != null ? money(p.totalCents) : "no total"}`,
    href: `/proposal/${p.token}`,
    highlight: zone ? `${zone.name}: ${zone.scope || zone.service}${zone.priceCents != null ? ` · ${money(zone.priceCents)}` : ""}${change ? ` → ${change}` : ""}` : null,
    lines: zone ? undefined : p.zones.map((z) => `${z.name}: ${z.scope || z.service}${z.priceCents != null ? ` · ${money(z.priceCents)}` : ""}`),
  };
}

function jobResources(f: PersonFacts): Resource[] {
  const out: Resource[] = [];
  if (f.jobId) out.push({ label: `Job${f.jobStatus ? ` · ${f.jobStatus.replace(/_/g, " ")}` : ""}`, href: `/jobs/${f.jobId}` });
  if (f.customerId) out.push({ label: "Contact", href: `/clients/${f.customerId}` });
  return out;
}

function paymentResource(f: PersonFacts): Resource | null {
  if (!f.invoice && !f.paidCents && !f.proposal?.paidAt) return null;
  const lines = [
    f.proposal?.paidAt ? `Proposal paid ${f.proposal.paidAt.slice(0, 10)}${f.proposal.paymentPath ? ` (${f.proposal.paymentPath.replace(/_/g, " ")})` : ""}` : null,
    f.paidCents ? `Payments received: ${money(f.paidCents)}` : null,
    `Balance: ${money(f.balanceCents)}`,
  ].filter((x): x is string => Boolean(x));
  return {
    label: f.invoice ? `Invoice · ${f.invoice.status} · ${money(f.invoice.amountCents)}` : "Payments",
    href: f.invoice?.href ?? (f.jobId ? `/jobs/${f.jobId}` : "/proposals"),
    highlight: f.balanceCents > 0 ? `${money(f.balanceCents)} still owed` : "Paid in full",
    lines,
  };
}

/** The next few Mondays, for "which week" when the scheduler has nothing. */
export function nextMondays(today: string, n = 3): string[] {
  const d = new Date(`${today}T12:00:00Z`);
  const out: string[] = [];
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

const RESOLVERS: Record<IntentId, Resolver> = {
  proposal_change: ({ facts, hint, said, answer }) => {
    const p = facts.proposal;
    const first = firstName(facts.name);
    if (!p) {
      return {
        resources: jobResources(facts),
        action: send(),
        question: answer ? null : { text: "They want a change, but there's no proposal on file for them. What should we do?", options: ["Ask what they want changed", "Start a new quote", "Call them"] },
        message: `Hi ${first}, happy to change it. Which part would you like different?`,
      };
    }
    const zone = (hint.zoneName ? p.zones.find((z) => z.name === hint.zoneName) : null) ?? zoneNamed([...said, answer ?? ""].join(" "), p.zones);
    const base = [proposalResource(p, zone), ...(p.jobId ? [{ label: "Pricing report", href: `/jobs/${p.jobId}/pricing-report`, highlight: zone ? zone.name : null }] : []), ...jobResources(facts)];
    if (!zone) {
      return {
        resources: base,
        action: send(),
        question: answer ? null : { text: "Which area of the proposal do they mean?", options: p.zones.map((z) => z.name).slice(0, 4) },
        message: `Hi ${first}, happy to adjust it. Which area would you like changed?`,
      };
    }
    const wantsRemove = hint.change === "remove" || /\b(remove|drop|take (it )?(off|out)|skip|without)\b/i.test(answer ?? "");
    const total = p.totalCents ?? 0;
    if (wantsRemove && zone.priceCents != null) {
      const newTotal = Math.max(0, total - zone.priceCents);
      return {
        resources: [proposalResource(p, zone, "remove"), ...base.slice(1)],
        action: { kind: "proposal_remove", label: `Take ${zone.name} off the proposal: ${money(total)} → ${money(newTotal)}`, proposalId: p.id, zoneName: zone.name, newTotalCents: newTotal },
        question: null,
        message: `Hi ${first}, done. I took ${zone.name} off, so the new total is ${money(newTotal)}. The same link shows the updated proposal.`,
      };
    }
    const newPrice = (answer ? dollarsIn(answer) : null) ?? hint.newPriceCents ?? null;
    if (zone.priceCents != null && newPrice != null && newPrice !== zone.priceCents) {
      const newTotal = Math.max(0, total - zone.priceCents + newPrice);
      return {
        resources: [proposalResource(p, zone, money(newPrice)), ...base.slice(1)],
        action: {
          kind: "proposal_price",
          label: `${zone.name}: ${money(zone.priceCents)} → ${money(newPrice)} (total ${money(total)} → ${money(newTotal)})`,
          jobId: p.jobId,
          zoneName: zone.name,
          fromCents: zone.priceCents,
          toCents: newPrice,
          newTotalCents: newTotal,
        },
        question: null,
        message: `Hi ${first}, no problem. I changed ${zone.name} to ${money(newPrice)}, so the new total is ${money(newTotal)}. The same link has the updated proposal whenever you're ready.`,
      };
    }
    if (answer && /keep/i.test(answer)) {
      return {
        resources: base,
        action: send("Keep the price and explain"),
        question: null,
        message: `Hi ${first}, thanks for asking. ${zone.name} is priced for the work it takes, so I'd keep it as it is. Happy to talk it through if that helps.`,
      };
    }
    const cut = (pct: number) => (zone.priceCents != null ? money(Math.round((zone.priceCents * (100 - pct)) / 100 / 500) * 500) : `${pct}% off`);
    return {
      resources: base,
      action: send(),
      question: answer
        ? null
        : {
            text: `What should ${zone.name} be?${zone.priceCents != null ? ` It's ${money(zone.priceCents)} now.` : ""}`,
            options: [cut(10), cut(15), "Remove the area", "Keep the price and explain"],
          },
      message: `Hi ${first}, thanks, I'll look at ${zone.name} and send you an updated proposal.`,
    };
  },

  proposal_accepted: ({ facts, hint, answer, today }) => {
    const p = facts.proposal;
    const first = firstName(facts.name);
    const resources: Resource[] = [];
    if (p) resources.push({ ...proposalResource(p), label: `Scope · ${p.zones.length} area${p.zones.length === 1 ? "" : "s"}${p.totalCents != null ? ` · ${money(p.totalCents)}` : ""}` });
    if (facts.materials.length) {
      const order = facts.materials.filter((m) => m.toOrder);
      resources.push({
        label: `Materials · ${order.length} to order`,
        href: "/admin/materials",
        highlight: order.length ? order.map((m) => `${m.name}: ${m.toOrder}`).join(" · ") : "Everything is in stock",
        lines: facts.materials.map((m) => `${m.name}: ${m.quantity}${m.toOrder ? ` (order ${m.toOrder})` : " (in stock)"}`),
      });
    }
    const slot = (hint.slotDate ? facts.slots.find((s) => s.date === hint.slotDate) : null) ?? facts.slots[0] ?? null;
    if (facts.slots.length) {
      resources.push({
        label: `Open days · ${facts.slots.length}`,
        href: "/evaluations",
        highlight: slot ? `${dayLabel(slot.date)} · ${slot.crewNames.join(", ")}` : null,
        lines: facts.slots.map((s) => `${dayLabel(s.date)}: ${s.crewNames.join(", ") || "crew to pick"}${s.because[0] ? `, ${s.because[0].charAt(0).toLowerCase()}${s.because[0].slice(1)}` : ""}`),
      });
    }
    const pay = paymentResource(facts);
    if (pay) resources.push(pay);
    if (p?.jobId) resources.push({ label: "Pricing report", href: `/jobs/${p.jobId}/pricing-report` });
    resources.push(...jobResources(facts));

    if (slot && facts.jobId) {
      return {
        resources,
        action: {
          kind: "book",
          label: `Book ${dayLabel(slot.date)} with ${slot.crewNames.join(", ") || "the suggested crew"}`,
          jobId: facts.jobId,
          date: slot.date,
          crewProfileIds: slot.crewProfileIds,
          crewNames: slot.crewNames,
          because: slot.because,
        },
        question: null,
        message: `Hi ${first}, thank you! You're all set. We have you booked for ${dayLabel(slot.date)}. We'll text the day before with an arrival time.`,
      };
    }
    const weeks = nextMondays(today);
    const picked = answer?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    return {
      resources,
      action: send(),
      question: answer ? null : { text: "The scheduler has no open day for this job. Which week should we offer?", options: [...weeks.map((w) => `Week of ${w}`), "Ask them what suits"] },
      message: picked
        ? `Hi ${first}, thank you! We're looking at the week of ${dayLabel(picked)} for your project. Does that week work for you?`
        : `Hi ${first}, thank you! Which days usually work best for you? We'll get you on the calendar.`,
    };
  },

  quote_request: ({ facts }) => ({
    resources: [{ label: "Booking page", href: "/book" }, ...jobResources(facts)],
    action: send(),
    question: null,
    message: facts.upcoming.length
      ? `Hi ${firstName(facts.name)}, thanks for reaching out! We'll see you ${dayLabel(facts.upcoming[0].date)} to look at it, and you'll have a price right after.`
      : `Hi ${firstName(facts.name)}, thanks for reaching out! What's the address? The quickest way to a price is to pick a time for us to come look on our booking page.`,
  }),

  schedule: ({ facts, hint }) => {
    const resources: Resource[] = [];
    if (facts.upcoming.length) resources.push({ label: `On the calendar · ${facts.upcoming.length}`, href: "/evaluations", lines: facts.upcoming.map((u) => `${dayLabel(u.date)}: ${u.label}`) });
    const slot = (hint.slotDate ? facts.slots.find((s) => s.date === hint.slotDate) : null) ?? facts.slots[0] ?? null;
    if (facts.slots.length) resources.push({ label: `Open days · ${facts.slots.length}`, href: "/evaluations", highlight: slot ? dayLabel(slot.date) : null, lines: facts.slots.map((s) => `${dayLabel(s.date)}: ${s.crewNames.join(", ")}`) });
    resources.push(...jobResources(facts));
    const first = firstName(facts.name);
    if (slot && facts.jobId && facts.proposal?.status === "accepted") {
      return {
        resources,
        action: { kind: "book", label: `Book ${dayLabel(slot.date)}`, jobId: facts.jobId, date: slot.date, crewProfileIds: slot.crewProfileIds, crewNames: slot.crewNames, because: slot.because },
        question: null,
        message: `Hi ${first}, no problem. We can do ${dayLabel(slot.date)}. You're on the calendar.`,
      };
    }
    return { resources, action: send(), question: null, message: `Hi ${first}, happy to sort the day out. Which days work best for you?` };
  },

  issue: ({ facts, answer }) => {
    const first = firstName(facts.name);
    return {
      resources: [...jobResources(facts), ...(facts.jobId ? [{ label: "Job photos", href: `/jobs/${facts.jobId}/photos` }] : [])],
      action: send(),
      question: answer ? null : { text: "How do we make this right?", options: ["Send the crew back, no charge", "Call them today", "Offer a partial refund"] },
      message: answer
        ? /crew back/i.test(answer)
          ? `Hi ${first}, I'm sorry about that. We'll send the crew back to fix it at no charge. What day works for you?`
          : /refund/i.test(answer)
            ? `Hi ${first}, I'm sorry about that. We'd like to make it right with a partial refund. Can I give you a call to sort it out?`
            : `Hi ${first}, I'm sorry about that. I'll call you today to make it right.`
        : `Hi ${first}, I'm sorry to hear that. Let me look into it and come back to you today.`,
    };
  },

  payment: ({ facts }) => {
    const pay = paymentResource(facts);
    const first = firstName(facts.name);
    return {
      resources: [...(pay ? [pay] : []), ...jobResources(facts)],
      action: send(),
      question: null,
      message:
        facts.balanceCents > 0
          ? `Hi ${first}, thanks for asking. The balance is ${money(facts.balanceCents)}. The invoice link has the details and a pay button.`
          : `Hi ${first}, thanks for asking. Everything is paid up on our end, nothing more is owed.`,
    };
  },

  thanks: ({ facts }) => ({
    resources: jobResources(facts),
    action: send("Thank them"),
    question: null,
    message: `Thank you, ${firstName(facts.name)}! We really appreciate it.`,
  }),

  question: ({ facts }) => ({
    resources: [...(facts.proposal ? [proposalResource(facts.proposal)] : []), ...jobResources(facts)],
    action: send(),
    question: null,
    message: `Hi ${firstName(facts.name)}, thanks for the message. Let me check and get right back to you.`,
  }),

  not_client: () => ({
    resources: [],
    action: { kind: "no_reply", label: "Don't reply. File it as done." },
    question: null,
    message: "",
  }),
};

/** The breakdown for one intent. */
export function resolveIntent(input: ResolveInput): Breakdown {
  const r = RESOLVERS[input.hint.intent](input);
  return { intent: input.hint.intent, summary: input.hint.summary || INTENTS[input.hint.intent], ...r };
}

/** The facts as words, for the model, with every price it may use. */
export function factsText(f: PersonFacts): string {
  const lines = [`Customer: ${f.name}`];
  if (f.address) lines.push(`Property: ${f.address}`);
  if (f.jobStatus) lines.push(`Job status: ${f.jobStatus}`);
  if (f.proposal) {
    lines.push(`Proposal: ${f.proposal.status}${f.proposal.totalCents != null ? `, total ${money(f.proposal.totalCents)}` : ""}${f.proposal.paidAt ? ", paid" : ""}`);
    for (const z of f.proposal.zones) lines.push(`- Area "${z.name}" (${z.service}): ${z.scope}${z.priceCents != null ? `, ${money(z.priceCents)}` : ""}`);
  }
  if (f.invoice) lines.push(`Invoice: ${f.invoice.status}, ${money(f.invoice.amountCents)}`);
  if (f.balanceCents) lines.push(`Balance owed: ${money(f.balanceCents)}`);
  if (f.slots.length) lines.push(`Open days: ${f.slots.map((s) => `${s.date} (${s.crewNames.join(", ")})`).join("; ")}`);
  if (f.upcoming.length) lines.push(`On the calendar: ${f.upcoming.map((u) => `${u.date} ${u.label}`).join("; ")}`);
  return lines.join("\n");
}
