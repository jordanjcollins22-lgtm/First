/**
 * Which domains we are allowed to send from, and why not the obvious one.
 *
 * Sending reputation attaches to the domain that signs the mail. Send a cold
 * campaign from jslandscapingmd.com and every bounce, spam report and dead
 * address on that list is spent against the same name that carries your
 * invoices, your proposals and your password resets. That damage is slow to
 * do and very slow to undo.
 *
 * So: never the root. Transactional mail goes from one subdomain, marketing
 * from a different one, and the root domain sends nothing — which leaves it
 * free to hold a strict DMARC policy and keeps its reputation untouchable
 * because it has no reputation to spend.
 *
 * The rule is enforced here rather than advised in a help page, because an
 * advisory version of this rule is one somebody skips at nine at night while
 * setting up a campaign.
 */

export type MailStream = "transactional" | "marketing";

export type DomainVerdict = { ok: true } | { ok: false; reason: string };

/** A hostname split into the bit you own and the bit in front of it. */
export interface ParsedHostname {
  hostname: string;
  /** The registrable domain — what you bought. */
  root: string;
  /** Everything in front of the root. Empty when the hostname is the root. */
  subdomain: string;
  isSubdomain: boolean;
}

/**
 * Suffixes where the registrable domain is three labels, not two.
 *
 * Not the full public suffix list — that is thousands of entries and a
 * dependency that needs updating. These are the ones a US landscaping
 * business plausibly meets. Anything outside it is treated as
 * last-two-labels, which is right for .com, .net, .org and every other flat
 * TLD, and is the only case that actually occurs here.
 */
const TWO_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "me.uk",
  "ltd.uk",
  "plc.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "com.br",
  "co.jp",
  "com.mx",
]);

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Split a hostname, or null if it is not one. */
export function parseHostname(input: string): ParsedHostname | null {
  const hostname = input
    .trim()
    .toLowerCase()
    // People paste URLs and addresses into domain boxes. Take the domain out
    // rather than refusing something that plainly contains one.
    .replace(/^https?:\/\//, "")
    .replace(/^.*@/, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  if (!hostname || hostname.length > 253) return null;

  const labels = hostname.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l) && l.length <= 63)) return null;

  const lastTwo = labels.slice(-2).join(".");
  const rootLabelCount = TWO_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length < rootLabelCount) return null;

  const root = labels.slice(-rootLabelCount).join(".");
  const subdomain = labels.slice(0, labels.length - rootLabelCount).join(".");

  return { hostname, root, subdomain, isSubdomain: subdomain.length > 0 };
}

/** A sending domain already set up. */
export interface ExistingDomain {
  hostname: string;
  stream: MailStream;
}

/**
 * Whether this domain can be added for this kind of mail.
 *
 * Refusals name the fix, not the rule — somebody typing their domain into a
 * box wants to know what to type instead.
 */
export function checkSendingDomain(
  input: string,
  stream: MailStream,
  existing: ExistingDomain[] = []
): DomainVerdict {
  const parsed = parseHostname(input);
  if (!parsed) return { ok: false, reason: "That doesn't look like a domain name." };

  if (!parsed.isSubdomain) {
    const suggested = suggestSubdomain(parsed.root, stream);
    return {
      ok: false,
      reason: `Don't send from ${parsed.root} itself — a bad campaign would take your main domain's reputation down with it, and that includes your invoices. Use ${suggested} instead.`,
    };
  }

  const already = existing.find((d) => d.hostname === parsed.hostname);
  if (already) {
    return already.stream === stream
      ? { ok: false, reason: "That one is already set up." }
      : {
          ok: false,
          reason: `${parsed.hostname} is already sending ${already.stream} mail. Keep the two apart — that separation is the whole point.`,
        };
  }

  return { ok: true };
}

/**
 * A subdomain to suggest for this stream.
 *
 * Different words for the two, deliberately. Reusing one subdomain for both
 * puts the campaign's reputation back on top of the invoices and undoes the
 * separation that made us split them up.
 */
export function suggestSubdomain(root: string, stream: MailStream): string {
  return `${stream === "marketing" ? "news" : "send"}.${root}`;
}

// ---------------------------------------------------------------------------
// Addresses on those domains
// ---------------------------------------------------------------------------

// Deliberately loose. The full grammar permits things no mail server accepts,
// and the authority on whether an address works is the address working.
const LOCAL_PART = /^[a-zA-Z0-9._%+-]+$/;

/**
 * Whether this address can be added under this domain.
 *
 * The address has to actually be on the domain we verified. Letting somebody
 * add jordan@jslandscapingmd.com under a verified send.jslandscapingmd.com
 * would produce mail that fails DKIM on every send, and the failure would
 * arrive as silence rather than an error.
 */
export function checkSenderAddress(address: string, domainHostname: string): DomainVerdict {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return { ok: false, reason: "That doesn't look like an email address." };
  }

  const local = trimmed.slice(0, at);
  const host = trimmed.slice(at + 1);

  if (!LOCAL_PART.test(local)) {
    return { ok: false, reason: "That doesn't look like an email address." };
  }
  if (host !== domainHostname.toLowerCase()) {
    return {
      ok: false,
      reason: `This address has to be @${domainHostname} — that's the domain we've verified. Anything else fails its signature check on every send.`,
    };
  }

  return { ok: true };
}

/** Normalised, so two spellings of one address cannot both be added. */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// What the DNS still needs
// ---------------------------------------------------------------------------

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  /** What the provider says about this one record, when it says anything. */
  status?: string | null;
  priority?: number | null;
}

export type DomainStatus = "pending" | "verified" | "failed";

/**
 * Plain English for where a domain has got to.
 *
 * "not_started" and "pending" are the same sentence to the person reading it:
 * the records are not in yet. Distinguishing them on screen would be exposing
 * our provider's state machine instead of answering the question.
 */
export function describeStatus(status: DomainStatus, records: DnsRecord[]): string {
  if (status === "verified") return "Verified — you can send from this domain.";
  if (status === "failed") {
    return "Verification failed. Check the records below match exactly, then check again.";
  }
  const outstanding = records.filter((r) => r.status && r.status !== "verified").length;
  if (outstanding > 0) {
    return `Waiting on ${outstanding} DNS record${outstanding === 1 ? "" : "s"}. They can take up to a few hours to show up.`;
  }
  return "Waiting on DNS. Add the records below at your domain host, then check again.";
}

/** Whether it is worth offering a "check again" button yet. */
export function canRecheck(status: DomainStatus): boolean {
  return status !== "verified";
}

/**
 * The domain to send a given piece of mail from.
 *
 * Marketing never falls back to the transactional domain. Silently sending a
 * campaign from the invoice domain because the marketing one was not ready is
 * exactly the outcome the split exists to prevent — better that the send
 * fails loudly and somebody finishes the setup.
 */
export function domainForStream<T extends { hostname: string; stream: MailStream; status: DomainStatus }>(
  domains: T[],
  stream: MailStream
): T | null {
  return domains.find((d) => d.stream === stream && d.status === "verified") ?? null;
}
