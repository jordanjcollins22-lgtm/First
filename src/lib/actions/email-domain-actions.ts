"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  checkSenderAddress,
  checkSendingDomain,
  normaliseAddress,
  parseHostname,
  type MailStream,
} from "@/lib/sending-domains";
import {
  createProviderDomain,
  deleteProviderDomain,
  getProviderDomain,
  verifyProviderDomain,
} from "@/lib/email/resend";

/** Results rather than throws — a thrown Server Action loses its message in
 * production and surfaces as an unexplained crash. */
export type EmailResult = { ok: true } | { ok: false; message: string };

function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message: string; code?: string };
    if (e.code === "23505") return "That's already set up.";
    return `${e.message}${e.code ? ` (${e.code})` : ""}`;
  }
  return "Something went wrong.";
}

async function assertAdmin(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Sign in first.";
  // Sending domains are the business's identity to the outside world, and a
  // wrong one is somebody else's mail arriving as ours.
  return profile.roles.includes("admin") ? null : "Only an admin can change email settings.";
}

/**
 * Register a sending subdomain and fetch the DNS it needs.
 *
 * The records come back from the provider and are stored exactly as given.
 * Reformatting a DKIM value is how you get a domain that never verifies and
 * an error message that never appears.
 */
export async function addSendingDomain(input: {
  hostname: string;
  stream: MailStream;
}): Promise<EmailResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: existingRows } = await supabase
      .from("email_domains")
      .select("hostname, stream")
      .eq("organization_id", organizationId);

    const existing = ((existingRows ?? []) as { hostname: string; stream: string }[]).map((r) => ({
      hostname: r.hostname,
      stream: r.stream as MailStream,
    }));

    const verdict = checkSendingDomain(input.hostname, input.stream, existing);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const parsed = parseHostname(input.hostname)!;

    const created = await createProviderDomain(parsed.hostname);
    if (!created.ok) return { ok: false, message: created.message };

    const profile = await getCurrentProfile();
    const { error } = await supabase.from("email_domains").insert({
      organization_id: organizationId,
      hostname: parsed.hostname,
      stream: input.stream,
      provider: "resend",
      provider_domain_id: created.data.id,
      status: created.data.status,
      dns_records: created.data.records,
      last_checked_at: new Date().toISOString(),
      created_by: profile?.id ?? null,
    });

    if (error) {
      // The domain now exists at the provider but not here. Left alone that
      // is a domain nobody can see and nobody can delete, and a second
      // attempt would fail on the provider's own duplicate check.
      await deleteProviderDomain(created.data.id).catch(() => {});
      return { ok: false, message: describe(error) };
    }

    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Ask the provider to re-read the DNS now. */
export async function recheckSendingDomain(domainId: string): Promise<EmailResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: domain } = await supabase
      .from("email_domains")
      .select("id, provider_domain_id")
      .eq("id", domainId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!domain?.provider_domain_id) {
      return { ok: false, message: "That domain isn't registered with the provider." };
    }

    // Nudge first, then read. Asking for the status without the nudge returns
    // whatever the last scheduled check found, which on a domain somebody
    // just fixed is the stale answer they are trying to get past.
    await verifyProviderDomain(domain.provider_domain_id);
    const fresh = await getProviderDomain(domain.provider_domain_id);
    if (!fresh.ok) return { ok: false, message: fresh.message };

    const { error } = await supabase
      .from("email_domains")
      .update({
        status: fresh.data.status,
        dns_records: fresh.data.records,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", domain.id);
    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Stop sending from a domain, here and at the provider. */
export async function removeSendingDomain(domainId: string): Promise<EmailResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: domain } = await supabase
      .from("email_domains")
      .select("id, provider_domain_id")
      .eq("id", domainId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!domain) return { ok: false, message: "That domain is already gone." };

    // Ours first. A provider delete that succeeds followed by a database
    // delete that fails leaves a domain the screen says works and nothing can
    // send from; this way round the worst case is a stray domain at Resend.
    const { error } = await supabase.from("email_domains").delete().eq("id", domain.id);
    if (error) return { ok: false, message: describe(error) };

    if (domain.provider_domain_id) {
      await deleteProviderDomain(domain.provider_domain_id).catch(() => {});
    }

    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * Add an address to send from.
 *
 * The address has to be on the domain we verified. An address on the root
 * under a verified subdomain would fail its signature check on every send,
 * and that failure arrives as silence rather than as an error.
 */
export async function addSender(input: {
  domainId: string;
  address: string;
  displayName?: string | null;
  replyTo?: string | null;
}): Promise<EmailResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: domain } = await supabase
      .from("email_domains")
      .select("id, hostname, status")
      .eq("id", input.domainId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!domain) return { ok: false, message: "Add the domain first." };

    const verdict = checkSenderAddress(input.address, domain.hostname);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const replyTo = input.replyTo?.trim();
    if (replyTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo)) {
      return { ok: false, message: "That reply-to address doesn't look right." };
    }

    const profile = await getCurrentProfile();
    const { count } = await supabase
      .from("email_senders")
      .select("id", { count: "exact", head: true })
      .eq("domain_id", domain.id);

    const { error } = await supabase.from("email_senders").insert({
      organization_id: organizationId,
      domain_id: domain.id,
      address: normaliseAddress(input.address),
      display_name: input.displayName?.trim() || null,
      reply_to: replyTo || null,
      // The first address on a domain is the one everything sends from until
      // somebody says otherwise. A domain with addresses and no default is a
      // domain that cannot send.
      is_default: (count ?? 0) === 0,
      created_by: profile?.id ?? null,
    });
    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Make this the address its domain sends from. */
export async function makeSenderDefault(senderId: string): Promise<EmailResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: sender } = await supabase
      .from("email_senders")
      .select("id, domain_id")
      .eq("id", senderId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!sender) return { ok: false, message: "That address is gone." };

    // Clear the old one first: there is a unique index on one default per
    // domain, and setting the new one while the old still holds it fails.
    const { error: clearError } = await supabase
      .from("email_senders")
      .update({ is_default: false })
      .eq("domain_id", sender.domain_id)
      .eq("is_default", true);
    if (clearError) return { ok: false, message: describe(clearError) };

    const { error } = await supabase
      .from("email_senders")
      .update({ is_default: true })
      .eq("id", sender.id);
    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Remove an address. */
export async function removeSender(senderId: string): Promise<EmailResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { error } = await supabase
      .from("email_senders")
      .delete()
      .eq("id", senderId)
      .eq("organization_id", organizationId);
    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}
