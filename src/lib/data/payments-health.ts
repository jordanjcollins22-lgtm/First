import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { notifyTeamMember } from "@/lib/notifications";
import {
  decideAlert,
  readStripeFailure,
  verdictForConfiguration,
  type PaymentsState,
  type StoredHealth,
  type Verdict,
} from "@/lib/payments-health";

/**
 * Asking Stripe whether it is still there, and telling somebody when it is not.
 *
 * Two ways in, on purpose. The daily pulse asks outright, which finds a rolled
 * key on a quiet week before a client ever meets it. And every Stripe failure
 * in a real payment reports itself, which finds it the instant it matters
 * rather than up to a day later.
 *
 * Both land here so the decision about whether to text anybody is made once.
 */

/** The cheapest authenticated question Stripe will answer. */
export async function probeStripe(): Promise<{ verdict: Verdict; detail: string | null }> {
  const unconfigured = verdictForConfiguration(isStripeConfigured);
  if (unconfigured) {
    return { verdict: unconfigured, detail: "No Stripe key is set on the deployment." };
  }

  try {
    // Balance rather than account: it is one object, it needs no permissions
    // beyond the key working, and it is the thing a restricted account stops
    // answering first.
    await stripeClient().balance.retrieve();
    return { verdict: "ok", detail: null };
  } catch (err) {
    return { verdict: readStripeFailure(err), detail: describe(err) };
  }
}

/**
 * Record what we found, and text the office if it is news.
 *
 * Returns what is now believed, so a caller can put it on a screen without a
 * second read.
 */
export async function recordPaymentsHealth(input: {
  organizationId: string;
  businessName: string;
  verdict: Verdict;
  detail?: string | null;
  now?: Date;
}): Promise<PaymentsState> {
  const admin = createAdminClient();
  const now = input.now ?? new Date();

  const { data: row } = await admin
    .from("payments_health")
    .select("state, changed_at, last_alert_at")
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  const stored: StoredHealth | null = row
    ? {
        state: row.state === "down" ? "down" : "ok",
        changedAt: row.changed_at,
        lastAlertAt: row.last_alert_at,
      }
    : null;

  const decision = decideAlert({
    stored,
    verdict: input.verdict,
    businessName: input.businessName,
    detail: input.detail,
    now,
  });

  await admin.from("payments_health").upsert(
    {
      organization_id: input.organizationId,
      state: decision.state,
      detail: decision.state === "down" ? (input.detail ?? null) : null,
      checked_at: now.toISOString(),
      ...(decision.changed ? { changed_at: now.toISOString() } : {}),
      ...(decision.alert ? { last_alert_at: now.toISOString() } : {}),
    },
    { onConflict: "organization_id" }
  );

  if (decision.alert) await tellTheOffice(input.organizationId, decision.alert, now);

  return decision.state;
}

/**
 * Report a Stripe call that failed during real work.
 *
 * Swallows everything. This runs inside the handling of a failure that has
 * already happened, and an alert that throws would turn a payment we could not
 * take into a page that will not load.
 */
export async function reportStripeFailure(organizationId: string, err: unknown): Promise<void> {
  try {
    const verdict = readStripeFailure(err);
    if (verdict === "unclear") return;

    const admin = createAdminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();

    await recordPaymentsHealth({
      organizationId,
      businessName: org?.name ?? "your business",
      verdict,
      detail: describe(err),
    });
  } catch (reportingError) {
    console.error("could not record a Stripe failure:", reportingError);
  }
}

/** What the office currently believes, for a screen. */
export async function paymentsHealthFor(
  organizationId: string
): Promise<{ state: PaymentsState; detail: string | null; changedAt: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("payments_health")
    .select("state, detail, changed_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  return {
    state: data.state === "down" ? "down" : "ok",
    detail: data.detail,
    changedAt: data.changed_at,
  };
}

/**
 * Whoever can actually do something about it.
 *
 * Admins, because reconnecting Stripe is an admin's job and telling a crew
 * member the payment processor is down is telling somebody who cannot fix it.
 *
 * Sent over the per-kind preference rather than under it. There is no toggle
 * for this and there should not be one — a business does not opt out of being
 * told its till is broken. The master "do not text me" switch still applies,
 * because that one is a person's explicit choice.
 */
async function tellTheOffice(organizationId: string, text: string, now: Date): Promise<void> {
  const admin = createAdminClient();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", organizationId);
  const ids = (profiles ?? []).map((p) => p.id);
  if (ids.length === 0) return;

  const { data: roles } = await admin
    .from("profile_roles")
    .select("profile_id")
    .eq("role_name", "admin")
    .in("profile_id", ids);

  const admins = Array.from(new Set((roles ?? []).map((r) => r.profile_id)));
  if (admins.length === 0) {
    console.warn(`Payments alert had nobody to go to: no admin in organisation ${organizationId}.`);
    return;
  }

  // Keyed to the hour, so a retried cron or two failures a second apart do
  // not text the same person twice about the same outage.
  const dedupeKey = `payments:${now.toISOString().slice(0, 13)}`;

  await Promise.all(
    admins.map((id) =>
      notifyTeamMember(id, "payments_down", text, {
        dedupeKey,
        overridesKindPreference: true,
      }).catch(() => false)
    )
  );
}

/** A sentence somebody can act on, out of whatever Stripe threw. */
function describe(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message : null;
  const code = typeof e.code === "string" ? ` (${e.code})` : "";
  return message ? `${message}${code}` : null;
}
