import { parseHostname, type DnsRecord } from "@/lib/sending-domains";

/**
 * Whether a DNS record has actually reached the internet.
 *
 * The provider says "pending" for every record until its own checker comes
 * round, which on a domain somebody fixed two minutes ago is the wrong
 * answer for the wrong reason. Somebody staring at four pending rows cannot
 * tell whether they typed one wrong, whether the host has not published yet,
 * or whether it is all fine and the provider is slow. So each record is
 * looked up on public resolvers and judged on its own: found and matching,
 * not there yet, or there with the wrong value. That is the difference
 * between "wait" and "go back and fix the third one".
 *
 * Pure. The lookups themselves happen in `data/dns-lookup.ts`; this decides
 * what a record should look like and what an answer means.
 */

export type LookupState = "found" | "missing" | "different" | "error";

export interface RecordLookup {
  state: LookupState;
  /** What to tell the person, in one line. */
  detail: string;
  /** When it was looked up. */
  at: string;
}

/** What the resolver handed back for one name and type. */
export interface Answer {
  /** TXT values with chunks already joined; CNAME/MX targets as strings. */
  values: string[];
  /** MX priorities alongside values, in the same order. */
  priorities?: number[];
  /** An error code from the resolver, when it errored rather than answered.
   * ENOTFOUND and ENODATA are not errors here: they are "not there yet". */
  error?: string | null;
}

/**
 * The full name to look up.
 *
 * The provider hands back names relative to the registrable domain: "send"
 * for send.example.com, "resend._domainkey.send" for its DKIM key. A domain
 * host wants the same thing, which is why the names are shown as they are.
 * A resolver wants the whole name, so the root is put back on here, unless
 * the provider already sent it whole.
 */
export function fullName(name: string, hostname: string): string {
  const parsed = parseHostname(hostname);
  const root = parsed?.root ?? hostname.toLowerCase();
  const trimmed = name.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed === "@") return root;
  if (trimmed === root || trimmed.endsWith(`.${root}`)) return trimmed;
  return `${trimmed}.${root}`;
}

function tidy(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^"+|"+$/g, "")
    .replace(/"\s+"/g, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

/**
 * What an answer means for this record.
 *
 * Matching is forgiving about the things hosts change on their own: case,
 * surrounding quotes, a trailing dot, the way a long TXT value is chopped
 * into 255-character chunks. It is strict about the content, because a DKIM
 * key with one character wrong is a DKIM key that fails, and "close enough"
 * would send somebody away thinking they were done.
 */
export function judge(record: DnsRecord, answer: Answer, at: string): RecordLookup {
  if (answer.error && answer.error !== "ENOTFOUND" && answer.error !== "ENODATA") {
    return { state: "error", detail: `Could not look it up just now (${answer.error}). Try again in a minute.`, at };
  }
  const found = answer.values.map(tidy).filter(Boolean);
  if (found.length === 0) {
    return { state: "missing", detail: "Not on the internet yet. Either it has not been added at your host, or it is still spreading.", at };
  }
  const want = tidy(record.value);
  const type = record.type.toUpperCase();

  if (type === "MX") {
    const index = found.findIndex((value) => value === want);
    if (index === -1) {
      return { state: "different", detail: `Found an MX record, but it points at ${found.join(", ")} instead of ${want}.`, at };
    }
    const priority = answer.priorities?.[index];
    if (record.priority != null && priority != null && priority !== record.priority) {
      return { state: "different", detail: `Found it, but with priority ${priority} instead of ${record.priority}.`, at };
    }
    return { state: "found", detail: "Found, and it matches.", at };
  }

  if (type === "TXT") {
    // Several TXT records can sit on one name. Ours only has to be one of them.
    if (found.includes(want)) return { state: "found", detail: "Found, and it matches.", at };
    const near = found.find((value) => value.slice(0, 12) === want.slice(0, 12));
    if (near) {
      return {
        state: "different",
        detail: "Found a record that starts the same but does not match. Usually a character dropped or an extra space when it was pasted. Copy it again from here.",
        at,
      };
    }
    return {
      state: "different",
      detail: `Found ${found.length} record${found.length === 1 ? "" : "s"} on that name, none of them ours: ${found.map((v) => `"${v.slice(0, 40)}${v.length > 40 ? "…" : ""}"`).join(", ")}.`,
      at,
    };
  }

  // CNAME and anything else: one value, must match.
  if (found.includes(want)) return { state: "found", detail: "Found, and it matches.", at };
  return { state: "different", detail: `Found ${found.join(", ")} instead of ${want}.`, at };
}

export const LOOKUP_LABEL: Record<LookupState, string> = {
  found: "Found",
  missing: "Not found yet",
  different: "Wrong value",
  error: "Could not check",
};

/**
 * The one line above the records.
 *
 * Counts what is actually there rather than what the provider has noticed,
 * so "3 of 4 found" tells somebody exactly which conversation to have with
 * their domain host.
 */
export function summariseLookups(records: DnsRecord[]): string | null {
  const looked = records.filter((r) => r.lookup);
  if (looked.length === 0) return null;
  const found = looked.filter((r) => r.lookup?.state === "found").length;
  const wrong = looked.filter((r) => r.lookup?.state === "different").length;
  const errored = looked.filter((r) => r.lookup?.state === "error").length;
  if (found === looked.length) {
    return "Every record is on the internet and matches. If the provider still says pending, press Check again; it only needs to notice.";
  }
  const parts = [`${found} of ${looked.length} record${looked.length === 1 ? "" : "s"} found on the internet.`];
  if (wrong > 0) parts.push(`${wrong} ${wrong === 1 ? "has" : "have"} the wrong value and need${wrong === 1 ? "s" : ""} redoing at your host.`);
  const missing = looked.length - found - wrong - errored;
  if (missing > 0) parts.push(`${missing} not there yet: add ${missing === 1 ? "it" : "them"} if you have not, otherwise give it a few minutes.`);
  if (errored > 0) parts.push(`${errored} could not be checked just now.`);
  return parts.join(" ");
}

/** Whether every looked-up record is in place, so the provider check is worth pressing. */
export function allFound(records: DnsRecord[]): boolean {
  return records.length > 0 && records.every((r) => r.lookup?.state === "found");
}
