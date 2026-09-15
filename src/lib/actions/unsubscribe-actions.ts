"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { recordConsent } from "@/lib/data/client-messaging";

/**
 * Take somebody off email, from a link in an email.
 *
 * Nobody is signed in, and nobody should have to be: the token in the link
 * identifies one client and the only thing it can do is stop us writing to
 * them. Failing closed here would mean an unsubscribe that does not work,
 * which is worse than almost anything it could be protecting against.
 */
export async function unsubscribeByToken(
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseAdminConfigured) return { ok: false, error: "Try again in a moment." };
  if (!token || token.length < 16) return { ok: false, error: "That link is not one of ours." };

  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("customers")
    .select("id, organization_id")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (!customer) return { ok: false, error: "That link has expired." };

  await recordConsent({
    organizationId: customer.organization_id,
    customerId: customer.id,
    channel: "email",
    state: "revoked",
    source: "unsubscribe_link",
    evidence: `Used the unsubscribe link on ${new Date().toISOString()}`,
  });

  return { ok: true };
}
