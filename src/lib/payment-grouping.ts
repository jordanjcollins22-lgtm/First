/**
 * Which payments belong to the same piece of work.
 *
 * Money arrives in pieces. A deposit to hold the date, a payment when the
 * crew finishes, sometimes five instalments across a spring. Those are one
 * project, and a list that shows them as five unrelated sums cannot answer
 * the only question anybody asks of it: what did we do for this person, and
 * what did they pay us for it.
 *
 * So payments are grouped, and the grouping is derived rather than stored.
 * A stored group is a decision that rots — the office attaches a payment to
 * the right project a week later and the stored copy still says otherwise.
 * Derived from what we know, it is right the moment the link changes.
 *
 * Three signals, strongest first. Nothing here guesses when it has been told.
 */

/** A payment as this module needs to see it. */
export interface PaymentRow {
  id: string;
  /** Whose it was. Null for money we could not match to a contact. */
  customerId: string | null;
  /** The project it is already attached to, if somebody has said. */
  jobId: string | null;
  amountCents: number;
  /** ISO timestamp. */
  receivedAt: string;
  /** Stripe's invoice, when the payment came through one. */
  stripeInvoiceId: string | null;
  /**
   * The email the payment itself came in with, for money that has no contact
   * on it. Two unmatched payments from the same address are the same person,
   * which is a firmer claim than the time window makes about anybody.
   */
  payerEmail?: string | null;
}

/** Why a group is a group. Shown to the user, so it has to be honest. */
export type GroupReason =
  /** Somebody attached these to a project. Not a guess. */
  | "job"
  /** They paid one invoice. Not a guess either. */
  | "invoice"
  /** Same contact, close together in time. This one is a guess. */
  | "window"
  /** Money with no contact on it. Stands alone until somebody says whose. */
  | "unmatched";

export interface PaymentGroup {
  key: string;
  customerId: string | null;
  /** The project, once there is one. Null means this group still needs one. */
  jobId: string | null;
  paymentIds: string[];
  totalCents: number;
  /** ISO timestamps of the earliest and latest payment in the group. */
  firstAt: string;
  lastAt: string;
  reason: GroupReason;
}

export interface GroupOptions {
  /**
   * How far apart two payments from one contact can be and still be treated
   * as the same project.
   *
   * Measured from the first payment in the group, not chained from the last.
   * Chaining has no ceiling: a customer who pays every month would have a
   * decade of unrelated work collapse into a single "project" one 60-day hop
   * at a time. Measured from the first, a group can never span more than this
   * many days, which is a claim that stays true.
   */
  windowDays?: number;
}

const DEFAULT_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Group payments into the projects they look like they belong to.
 *
 * Three rules, and a payment obeys all of them at once — which is why this
 * joins payments up rather than filing each under a single key. A key would
 * make attaching one payment of an invoice to a project tear the rest of that
 * invoice away from it, and the office attaching one payment is precisely
 * when the group most needs to stay whole.
 *
 *   1. Payments on the same project are one group. Somebody said so.
 *   2. Payments on the same invoice are one group. The customer said so.
 *   3. A payment with neither joins the contact's nearby work — this is the
 *      deposit that was taken before there was anything to invoice.
 *
 * Rule 3 deliberately never applies to a payment that already has an invoice
 * on it, so two separate invoices a fortnight apart stay two projects. An
 * invoice is a statement that this is one job, and time is only a guess.
 *
 * Returned oldest group first. Within a group, payment ids are in the order
 * the money arrived, so the deposit reads before the balance.
 */
export function groupPayments(rows: PaymentRow[], options: GroupOptions = {}): PaymentGroup[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Oldest first, and stable on ties by id so two payments recorded in the
  // same second do not swap places between one render and the next.
  const ordered = [...rows].sort((a, b) => {
    const at = Date.parse(a.receivedAt);
    const bt = Date.parse(b.receivedAt);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const union = new Union();
  for (const row of ordered) union.add(row.id);

  // Rules 1 and 2: join everything that shares a project or an invoice.
  joinBy(ordered, union, (r) => (r.jobId ? `job:${r.jobId}` : null));
  joinBy(ordered, union, (r) => (r.stripeInvoiceId ? `inv:${r.stripeInvoiceId}` : null));

  // Money with no contact, joined by the email the payment arrived with. Only
  // for rows that have no contact: one that does is already grouped by it, and
  // a payer email is what the card was registered to rather than who the work
  // was for. Grouped, the office links one card and all of that person's money
  // moves at once instead of three cards saying the same thing.
  joinBy(ordered, union, (r) =>
    !r.customerId && r.payerEmail ? `payer:${r.payerEmail.trim().toLowerCase()}` : null
  );

  // Rule 3, per contact, in time order. The anchor is the first payment of
  // the group being built, not the previous payment: chaining has no ceiling,
  // and a customer who pays every month would have a decade of unrelated work
  // collapse into one project a single 60-day hop at a time.
  const byContact = new Map<string, PaymentRow[]>();
  for (const row of ordered) {
    if (!row.customerId) continue;
    const list = byContact.get(row.customerId);
    if (list) list.push(row);
    else byContact.set(row.customerId, [row]);
  }

  for (const list of byContact.values()) {
    let anchor: PaymentRow | null = null;
    // The invoice the anchor's group has landed on, if it has one yet. A
    // deposit starts with none, which is what lets the invoice that follows
    // it join — the deposit was taken before there was anything to invoice.
    let anchorInvoice: string | null = null;

    for (const row of list) {
      if (!anchor || !withinWindow(anchor.receivedAt, row.receivedAt, windowDays)) {
        anchor = row;
        anchorInvoice = row.stripeInvoiceId;
        continue;
      }
      // Two different invoices are two jobs, however close together they fell.
      if (row.stripeInvoiceId && anchorInvoice && row.stripeInvoiceId !== anchorInvoice) {
        anchor = row;
        anchorInvoice = row.stripeInvoiceId;
        continue;
      }
      union.join(anchor.id, row.id);
      anchorInvoice = anchorInvoice ?? row.stripeInvoiceId;
    }
  }

  return build(ordered, union);
}

/** Join every row that answers to the same non-null key. */
function joinBy(
  rows: PaymentRow[],
  union: Union,
  keyOf: (row: PaymentRow) => string | null
): void {
  const firstSeen = new Map<string, string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const first = firstSeen.get(key);
    if (first) union.join(first, row.id);
    else firstSeen.set(key, row.id);
  }
}

/** Turn the joined-up ids back into groups, in the order the money arrived. */
function build(ordered: PaymentRow[], union: Union): PaymentGroup[] {
  const byId = new Map(ordered.map((r) => [r.id, r]));
  const groups = new Map<string, PaymentGroup>();

  for (const row of ordered) {
    const root = union.find(row.id);
    const existing = groups.get(root);
    if (existing) {
      existing.paymentIds.push(row.id);
      existing.totalCents += row.amountCents;
      existing.lastAt = row.receivedAt;
      if (row.jobId && !existing.jobId) existing.jobId = row.jobId;
      // A group is only as unattributed as its least-known member: if any
      // payment in it names a contact, the group belongs to that contact.
      if (row.customerId && !existing.customerId) existing.customerId = row.customerId;
      continue;
    }
    groups.set(root, {
      // Keyed on the earliest payment in the group, so the key survives a
      // later payment arriving and does not renumber the whole list.
      key: `grp:${root}`,
      customerId: row.customerId,
      jobId: row.jobId,
      paymentIds: [row.id],
      totalCents: row.amountCents,
      firstAt: row.receivedAt,
      lastAt: row.receivedAt,
      reason: "window",
    });
  }

  for (const group of groups.values()) {
    group.reason = reasonFor(group, byId);
  }

  return [...groups.values()].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
}

/** Why this group is a group — the strongest thing true of it. */
function reasonFor(group: PaymentGroup, byId: Map<string, PaymentRow>): GroupReason {
  if (group.jobId) return "job";
  const rows = group.paymentIds.map((id) => byId.get(id)!);
  if (rows.some((r) => r.stripeInvoiceId)) return "invoice";
  if (group.customerId) return "window";
  return "unmatched";
}

function withinWindow(firstAt: string, at: string, windowDays: number): boolean {
  const span = Date.parse(at) - Date.parse(firstAt);
  return Number.isFinite(span) && span <= windowDays * DAY_MS;
}

/** Disjoint sets, small and to the point. */
class Union {
  private parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = this.parent.get(id) ?? id;
    while (root !== this.parent.get(root)) root = this.parent.get(root)!;
    // Flatten, so a long chain is walked once rather than every lookup.
    let walk = id;
    while (walk !== root) {
      const next = this.parent.get(walk)!;
      this.parent.set(walk, root);
      walk = next;
    }
    return root;
  }

  join(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // The earlier id wins, so a group's key is its first payment and stays
    // put when later payments join.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

/**
 * Groups that have money but no project yet.
 *
 * This is the work list: each one is a piece of work somebody paid for that
 * the app cannot yet show as a project.
 */
export function groupsNeedingProject(groups: PaymentGroup[]): PaymentGroup[] {
  return groups.filter((g) => g.jobId === null);
}

/**
 * Contacts who have paid us and have nothing documented.
 *
 * A contact with three projects and one stray payment is not on this list —
 * they are documented, and the stray is a reconciliation. This is the harder
 * case: money in, nothing at all to show for it.
 */
export function contactsWithNoProject(groups: PaymentGroup[]): string[] {
  const documented = new Set<string>();
  const paying = new Set<string>();
  for (const g of groups) {
    if (!g.customerId) continue;
    paying.add(g.customerId);
    if (g.jobId) documented.add(g.customerId);
  }
  return [...paying].filter((id) => !documented.has(id)).sort();
}

export interface GroupSummary {
  groups: number;
  linked: number;
  needingProject: number;
  totalCents: number;
  linkedCents: number;
  unlinkedCents: number;
  /** Money we cannot attribute to any contact at all. */
  unmatchedCents: number;
}

export function summarise(groups: PaymentGroup[]): GroupSummary {
  let linked = 0;
  let totalCents = 0;
  let linkedCents = 0;
  let unmatchedCents = 0;

  for (const g of groups) {
    totalCents += g.totalCents;
    if (g.jobId) {
      linked += 1;
      linkedCents += g.totalCents;
    }
    if (!g.customerId) unmatchedCents += g.totalCents;
  }

  return {
    groups: groups.length,
    linked,
    needingProject: groups.length - linked,
    totalCents,
    linkedCents,
    unlinkedCents: totalCents - linkedCents,
    unmatchedCents,
  };
}

/**
 * A name for the project a group would become.
 *
 * Dated rather than clever. "Work in March 2026" is a label somebody can
 * recognise and rename; a made-up description of work nobody recorded is a
 * label that reads like fact and is not.
 */
export function suggestedProjectName(group: PaymentGroup, now: Date = new Date()): string {
  const first = new Date(group.firstAt);
  const when = Number.isNaN(first.getTime()) ? now : first;
  const month = when.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return `Work in ${month}`;
}
