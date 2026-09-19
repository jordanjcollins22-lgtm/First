import { createAdminClient } from "@/lib/supabase/admin";
import { getProviderDomain, verifyProviderDomain } from "@/lib/email/resend";
import { isResendConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import type { MailStream } from "@/lib/sending-domains";

/** How often a pending domain is asked about, so a busy day is not a hundred provider calls. */
const RECHECK_AFTER_MS = 10 * 60 * 1000;

/**
 * Gets the business's mail ready to send without anybody pressing anything.
 *
 * Two things stopped every automatic email for a week. The sending domain
 * sat "pending" at the provider after its DNS had gone in, because nobody
 * came back to press Re-check. And a verified domain still could not send,
 * because nobody had added an address on it. Both are now done on the way
 * out of the door: a pending domain is re-checked with the provider every
 * ten minutes at most, and a verified domain with no address gets
 * hello@ that domain, named for the business, with replies going to the
 * business's own inbox.
 *
 * Returns whether a send is now worth attempting.
 */
export async function ensureSendingReady(organizationId: string, stream: MailStream): Promise<boolean> {
  if (!isResendConfigured) return false;
  const admin = createAdminClient();
  try {
    const { data: domain } = await admin
      .from("email_domains")
      .select("id, hostname, status, provider_domain_id, last_checked_at")
      .eq("organization_id", organizationId)
      .eq("stream", stream)
      .maybeSingle();
    if (!domain) return false;

    let status = domain.status;
    if (status !== "verified" && domain.provider_domain_id) {
      const last = domain.last_checked_at ? new Date(domain.last_checked_at).getTime() : 0;
      if (Date.now() - last >= RECHECK_AFTER_MS) {
        // Claimed first, so two sends at once do not both ask the provider.
        await admin.from("email_domains").update({ last_checked_at: new Date().toISOString() }).eq("id", domain.id);
        await verifyProviderDomain(domain.provider_domain_id).catch(() => null);
        const fresh = await getProviderDomain(domain.provider_domain_id);
        if (fresh.ok) {
          status = fresh.data.status;
          await admin
            .from("email_domains")
            .update({ status: fresh.data.status, dns_records: fresh.data.records, last_checked_at: new Date().toISOString() })
            .eq("id", domain.id);
          log.info("email.domain.rechecked", { organizationId, hostname: domain.hostname, status });
        }
      }
    }
    if (status !== "verified") return false;

    const { count } = await admin.from("email_senders").select("id", { count: "exact", head: true }).eq("domain_id", domain.id);
    if ((count ?? 0) > 0) return true;

    const { data: org } = await admin.from("organizations").select("name, business_email").eq("id", organizationId).maybeSingle();
    const { error } = await admin.from("email_senders").insert({
      organization_id: organizationId,
      domain_id: domain.id,
      address: `hello@${domain.hostname.toLowerCase()}`,
      display_name: org?.name ?? null,
      reply_to: org?.business_email ?? null,
      is_default: true,
    });
    if (error) {
      log.warn("email.sender.auto_failed", { organizationId, hostname: domain.hostname, error: error.message });
      return false;
    }
    log.info("email.sender.auto_created", { organizationId, hostname: domain.hostname });
    return true;
  } catch (err) {
    log.warn("email.ready.failed", { organizationId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
