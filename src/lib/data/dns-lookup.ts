import { Resolver } from "node:dns/promises";

import { fullName, judge, type Answer, type RecordLookup } from "@/lib/dns-check";
import type { DnsRecord } from "@/lib/sending-domains";

/**
 * Asking the public internet whether a record is there.
 *
 * Deliberately not the server's own resolver. What matters is what the
 * provider's checker and the world's mail servers will see, and the nearest
 * thing to that is the two big public resolvers. Cloudflare is asked first,
 * Google if it fails, so a hiccup at one does not read as a missing record.
 *
 * Each lookup is capped at a few seconds. A slow resolver must not hold the
 * settings page hostage, and "could not check" is an honest answer.
 */
const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];
const TIMEOUT_MS = 4000;

function resolver(server: string): Resolver {
  const r = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });
  r.setServers([server]);
  return r;
}

async function ask(record: DnsRecord, name: string, server: string): Promise<Answer> {
  const r = resolver(server);
  const type = record.type.toUpperCase();
  try {
    if (type === "MX") {
      const rows = await r.resolveMx(name);
      const sorted = [...rows].sort((a, b) => a.priority - b.priority);
      return { values: sorted.map((row) => row.exchange), priorities: sorted.map((row) => row.priority) };
    }
    if (type === "CNAME") {
      return { values: await r.resolveCname(name) };
    }
    // TXT comes back as chunks per record; joining is what the reader does.
    const rows = await r.resolveTxt(name);
    return { values: rows.map((chunks) => chunks.join("")) };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "EUNKNOWN";
    return { values: [], error: code };
  }
}

/** One record, judged. Falls through to the second resolver only on a real error. */
export async function lookupRecord(record: DnsRecord, hostname: string, at = new Date().toISOString()): Promise<RecordLookup> {
  const name = fullName(record.name, hostname);
  let answer = await ask(record, name, PUBLIC_RESOLVERS[0]);
  if (answer.error && answer.error !== "ENOTFOUND" && answer.error !== "ENODATA") {
    answer = await ask(record, name, PUBLIC_RESOLVERS[1]);
  }
  return judge(record, answer, at);
}

/** Every record on a domain, looked up together, each carrying its answer. */
export async function lookupRecords(records: DnsRecord[], hostname: string): Promise<DnsRecord[]> {
  const at = new Date().toISOString();
  const lookups = await Promise.all(records.map((record) => lookupRecord(record, hostname, at)));
  return records.map((record, index) => ({ ...record, lookup: lookups[index] }));
}
