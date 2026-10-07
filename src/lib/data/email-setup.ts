import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { isResendConfigured } from "@/lib/env";
import {
  parseHostname,
  suggestSubdomain,
  type DnsRecord,
  type DomainStatus,
  type MailStream,
} from "@/lib/sending-domains";

export interface SendingDomain {
  id: string;
  hostname: string;
  stream: MailStream;
  status: DomainStatus;
  records: DnsRecord[];
  lastCheckedAt: string | null;
  senders: Sender[];
}

export interface Sender {
  id: string;
  address: string;
  displayName: string | null;
  replyTo: string | null;
  isDefault: boolean;
}

export interface EmailSetup {
  /** Whether the provider key is present at all. Nothing works without it. */
  connected: boolean;
  domains: SendingDomain[];
  /** What to put in the box, worked out from a domain they already added. */
  suggestions: { transactional: string | null; marketing: string | null };
}

/** Everything the email settings screen shows. */
export async function getEmailSetup(): Promise<EmailSetup> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const [{ data: domainRows }, { data: senderRows }] = await Promise.all([
    supabase
      .from("email_domains")
      .select("id, hostname, stream, status, dns_records, last_checked_at")
      .eq("organization_id", organizationId)
      .order("stream", { ascending: true }),
    supabase
      .from("email_senders")
      .select("id, domain_id, address, display_name, reply_to, is_default")
      .eq("organization_id", organizationId)
      .order("address", { ascending: true }),
  ]);

  const sendersByDomain = new Map<string, Sender[]>();
  for (const row of (senderRows ?? []) as {
    id: string;
    domain_id: string;
    address: string;
    display_name: string | null;
    reply_to: string | null;
    is_default: boolean;
  }[]) {
    const list = sendersByDomain.get(row.domain_id) ?? [];
    list.push({
      id: row.id,
      address: row.address,
      displayName: row.display_name,
      replyTo: row.reply_to,
      isDefault: row.is_default,
    });
    sendersByDomain.set(row.domain_id, list);
  }

  const domains: SendingDomain[] = (
    (domainRows ?? []) as {
      id: string;
      hostname: string;
      stream: string;
      status: string;
      dns_records: unknown;
      last_checked_at: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    hostname: row.hostname,
    stream: row.stream as MailStream,
    status: row.status as DomainStatus,
    records: Array.isArray(row.dns_records) ? (row.dns_records as DnsRecord[]) : [],
    lastCheckedAt: row.last_checked_at,
    senders: sendersByDomain.get(row.id) ?? [],
  }));

  return {
    connected: isResendConfigured,
    domains,
    suggestions: suggestionsFrom(domains),
  };
}

/**
 * What to prefill the "add a domain" box with.
 *
 * Taken from a domain they have already added, so the second one is a tap
 * rather than a spelling test. Nothing to suggest before the first: guessing
 * the business's domain from its name would be wrong more often than right.
 */
function suggestionsFrom(domains: SendingDomain[]): EmailSetup["suggestions"] {
  const known = domains.map((d) => parseHostname(d.hostname)?.root).find(Boolean);
  if (!known) return { transactional: null, marketing: null };

  const taken = new Set(domains.map((d) => d.stream));
  return {
    transactional: taken.has("transactional") ? null : suggestSubdomain(known, "transactional"),
    marketing: taken.has("marketing") ? null : suggestSubdomain(known, "marketing"),
  };
}
