"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { loadSequenceSettings, openAutomationException, untyped } from "@/lib/data/client-automations";
import { lowRatingKey, routeRating } from "@/lib/client-automations/reviews";

/**
 * The public /rate/<token> page's two buttons: a 1–5 rating, then (below
 * five) a line about what to fix. No sign-in: the token is the whole
 * authorisation, and it names one finished job.
 */

export interface RatingAsk {
  businessName: string;
  clientFirstName: string | null;
  rating: number | null;
  feedback: string | null;
  googleLink: string | null;
}

type RequestRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  job_id: string;
  rating: number | null;
  feedback: string | null;
  sent_to_google_at: string | null;
};

async function requestByToken(token: string): Promise<RequestRow | null> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return null;
  const sb = untyped(createAdminClient());
  const { data } = await sb
    .from("review_requests")
    .select("id, organization_id, customer_id, job_id, rating, feedback, sent_to_google_at")
    .eq("token", token)
    .maybeSingle();
  return (data as RequestRow | null) ?? null;
}

export async function ratingAskByToken(token: string): Promise<RatingAsk | null> {
  const row = await requestByToken(token);
  if (!row) return null;
  const admin = createAdminClient();
  const [{ data: org }, { data: customer }, settings] = await Promise.all([
    admin.from("organizations").select("name").eq("id", row.organization_id).maybeSingle(),
    admin.from("customers").select("name").eq("id", row.customer_id).maybeSingle(),
    loadSequenceSettings(admin, row.organization_id),
  ]);
  return {
    businessName: org?.name ?? "Us",
    clientFirstName: customer?.name?.trim().split(/\s+/)[0] || null,
    rating: row.rating,
    feedback: row.feedback,
    googleLink: settings.review_requests.config.googleReviewLink || null,
  };
}

export type RateResult = { ok: true; route: "google" | "owner" | "thanks"; googleLink: string | null } | { ok: false; message: string };

/** One tap. A five goes on to Google; anything lower asks what to fix and tells the owner. */
export async function submitRating(token: string, rating: number): Promise<RateResult> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, message: "Pick 1 to 5." };
  const row = await requestByToken(token);
  if (!row) return { ok: false, message: "This link isn't active." };
  const admin = createAdminClient();
  const sb = untyped(admin);
  const settings = await loadSequenceSettings(admin, row.organization_id);
  const googleLink = settings.review_requests.config.googleReviewLink || null;

  // The first answer stands. Tapping again just shows where it led.
  if (row.rating != null) return { ok: true, route: routeRating(row.rating, googleLink ?? ""), googleLink };

  const now = new Date().toISOString();
  const route = routeRating(rating, googleLink ?? "");
  const { error } = await sb
    .from("review_requests")
    .update({ rating, rated_at: now, ...(route === "google" ? { sent_to_google_at: now } : {}) })
    .eq("id", row.id)
    .is("rating", null);
  if (error) return { ok: false, message: "Couldn't save that. Please try again." };

  // In the job's thread, where the team reads what the client says.
  await admin
    .from("job_messages")
    .insert({
      job_id: row.job_id,
      organization_id: row.organization_id,
      channel: "internal",
      author_type: "client",
      author_name: "Client",
      body: `Rated the job ${rating} out of 5${route === "google" ? " and was sent on to leave a Google review." : "."}`,
    })
    .then(() => undefined, () => undefined);

  if (route === "owner") {
    const { data: customer } = await admin.from("customers").select("name").eq("id", row.customer_id).maybeSingle();
    await openAutomationException({
      organizationId: row.organization_id,
      kind: "low_rating",
      summary: `${customer?.name?.trim() || "A client"} rated their job ${rating} out of 5.`,
      detail: "Call them before anything else goes out. Their note, if they leave one, appears here.",
      customerId: row.customer_id,
      jobId: row.job_id,
      referenceId: row.id,
      dedupeKey: lowRatingKey(row.id),
    }).catch((err) => log.warn("rating.exception_failed", { error: err instanceof Error ? err.message : String(err) }));
  }
  return { ok: true, route, googleLink };
}

/** What they'd fix, below five. Added to the owner's exception. */
export async function submitFeedback(token: string, text: string): Promise<{ ok: boolean; message: string }> {
  const words = text.trim().slice(0, 2000);
  if (!words) return { ok: false, message: "Write a line first." };
  const row = await requestByToken(token);
  if (!row || row.rating == null) return { ok: false, message: "This link isn't active." };
  const admin = createAdminClient();
  const sb = untyped(admin);
  await sb.from("review_requests").update({ feedback: words }).eq("id", row.id);
  await sb
    .from("client_automation_exceptions")
    .update({ detail: `They wrote: "${words}"` })
    .eq("organization_id", row.organization_id)
    .eq("dedupe_key", lowRatingKey(row.id));
  await admin
    .from("job_messages")
    .insert({ job_id: row.job_id, organization_id: row.organization_id, channel: "internal", author_type: "client", author_name: "Client", body: `About their rating: "${words}"` })
    .then(() => undefined, () => undefined);
  return { ok: true, message: "Thank you. The owner reads every one of these." };
}
