import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { outboundBaseUrl } from "@/lib/base-url";
import { bookingDestination } from "@/lib/outreach-links";

/**
 * Every handed-out link comes through here.
 *
 * A comment under a stranger's post, a scheduled page post, a flyer, an
 * affiliate's own link: they all carry a short code, and this is what turns
 * that code into a destination. Two reasons it is a route of its own rather
 * than the booking page with a parameter on it.
 *
 * The first is counting. A booking says the link worked; a click says somebody
 * looked. Between those two is the whole of what is worth knowing about a
 * group — a room that reads comments and does not book needs different words,
 * and a room that never clicks at all needs abandoning, and neither of those
 * is visible if the only thing recorded is bookings.
 *
 * The second is that a link outlives its destination. Once a code is in
 * somebody else's Facebook thread it can never be edited, so where it goes has
 * to be decided at the moment it is opened rather than baked in at the moment
 * it was posted.
 *
 * Nothing identifying is kept. A click is a stranger who has not asked us for
 * anything; the only honest record is that it happened, and roughly from
 * where.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  const { code } = await context.params;
  const baseUrl = (await outboundBaseUrl()) || request.nextUrl.origin;
  const fallback = NextResponse.redirect(`${baseUrl.replace(/\/$/, "")}/book`, 302);

  if (!isSupabaseConfigured || !code) return fallback;

  try {
    const admin = createAdminClient();
    const { data: link } = await admin
      .from("outreach_links")
      .select("id, organization_id, profile_id, click_count")
      .eq("code", code)
      .maybeSingle();

    // An unknown code still goes somewhere. Somebody mistyped it off a flyer,
    // or a link outlived the row behind it, and a 404 in front of a customer
    // who was trying to book is a customer lost to a database detail.
    if (!link) return fallback;

    const [{ data: org }, { data: sender }] = await Promise.all([
      admin.from("organizations").select("slug").eq("id", link.organization_id).maybeSingle(),
      admin.from("profiles").select("affiliate_slug").eq("id", link.profile_id).maybeSingle(),
    ]);

    const destination = bookingDestination({
      baseUrl,
      orgSlug: org?.slug ?? null,
      affiliateSlug: sender?.affiliate_slug ?? null,
      code,
    });

    // Counted before the redirect is returned, but never allowed to hold it
    // up or fail it: somebody standing on a pavement waiting on our bookkeeping
    // is the wrong trade, and a click we failed to record is worth less than a
    // customer who gave up.
    await recordClick(admin, link, request).catch((err) =>
      console.error("couldn't record a click:", err)
    );

    return NextResponse.redirect(destination, 302);
  } catch (err) {
    console.error("tracked link failed:", err);
    return fallback;
  }
}

async function recordClick(
  admin: ReturnType<typeof createAdminClient>,
  link: { id: string; organization_id: string; click_count: number },
  request: NextRequest
): Promise<void> {
  const now = new Date().toISOString();
  const source = hostOf(request.headers.get("referer"));

  await Promise.all([
    admin.from("outreach_clicks").insert({
      organization_id: link.organization_id,
      link_id: link.id,
      clicked_at: now,
      source,
    }),
    admin
      .from("outreach_links")
      .update({
        click_count: (link.click_count ?? 0) + 1,
        last_click_at: now,
        // Only the first one. Written unconditionally would make every click
        // look like the first, which is the one thing the column is for.
        ...(link.click_count > 0 ? {} : { first_click_at: now }),
      })
      .eq("id", link.id),
  ]);
}

/**
 * Where a click came from, at the coarsest useful grain.
 *
 * "facebook.com" answers which room it was; the full URL of somebody's feed
 * answers nothing and is not ours to keep.
 */
function hostOf(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).hostname.replace(/^www\./, "").slice(0, 100);
  } catch {
    return null;
  }
}
