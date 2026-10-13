import type { SupabaseClient } from "@supabase/supabase-js";

import { mayActOn, type AutopilotSettings, type StartedMap } from "@/lib/marketing/autopilot-settings";
import { localDay, nextCappedSlot, reslotOverdue } from "@/lib/marketing/social-autopost";
import { pairPhotos, suggestCaption, townFromAddress, type PhotoKind } from "@/lib/social-post";

/**
 * The scheduled-posts side of the autopilot: make posts from crew-approved
 * photos, and move stuck ones forward. Publishing itself stays with the
 * existing social-posts cron, which already sends to the connected Facebook
 * page (or the webhook) once a post's time comes.
 *
 * Runs with the service role.
 */

const untyped = (c: unknown) => c as SupabaseClient;

const DEFAULT_PHONE = "443-819-1521";

export interface SocialRunResult {
  made: number;
  reslotted: number;
}

export async function runSocialAutopilot(
  client: unknown,
  org: string,
  autopilot: { settings: AutopilotSettings; started: StartedMap },
  now = new Date()
): Promise<SocialRunResult> {
  const sb = untyped(client);
  const { settings, started } = autopilot;
  const result: SocialRunResult = { made: 0, reslotted: 0 };

  const { data: scheduledRows } = await sb
    .from("social_posts")
    .select("id, scheduled_for, status, plan_day")
    .eq("organization_id", org)
    .eq("placement", "page")
    .in("status", ["scheduled", "posted"])
    .gte("scheduled_for", new Date(now.getTime() - 60 * 86_400_000).toISOString())
    .limit(500);
  const rows = (scheduledRows ?? []) as { id: string; scheduled_for: string | null; status: string; plan_day: string | null }[];
  const planned = new Set(rows.filter((r) => r.plan_day).map((r) => r.id));

  // 1. Stuck posts forward.
  if (settings.enabled.social_reslot) {
    const overdue = rows.filter((r) => r.status === "scheduled" && r.scheduled_for && Date.parse(r.scheduled_for) < now.getTime()).map((r) => ({ id: r.id, scheduledFor: r.scheduled_for as string }));
    const upcoming = rows.filter((r) => r.scheduled_for && Date.parse(r.scheduled_for) >= now.getTime()).map((r) => r.scheduled_for as string);
    for (const move of reslotOverdue(overdue, upcoming, now)) {
      // A planned post's day moves with it, so the picture's "this week" stays true.
      const { error } = await sb
        .from("social_posts")
        .update({
          scheduled_for: move.scheduledFor,
          ...(planned.has(move.id) ? { plan_day: localDay(move.scheduledFor) } : {}),
          updated_at: now.toISOString(),
        })
        .eq("id", move.id)
        .eq("status", "scheduled");
      if (error) continue;
      upcoming.push(move.scheduledFor);
      result.reslotted++;
    }
  }

  // 2. New posts from crew-approved photos.
  if (!settings.enabled.social_autopost || !started.social_autopost) return result;
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, name, photos_approved_at, properties!inner(address, customers!inner(organization_id))")
    .eq("properties.customers.organization_id", org)
    .not("photos_approved_at", "is", null)
    .gte("photos_approved_at", started.social_autopost)
    .order("photos_approved_at", { ascending: true })
    .limit(20);
  const candidates = ((jobs ?? []) as unknown as { id: string; name: string; photos_approved_at: string; properties: { address: string | null } | null }[]).filter((j) =>
    mayActOn("social_autopost", settings, started, j.photos_approved_at)
  );
  if (candidates.length === 0) return result;

  const ids = candidates.map((j) => j.id);
  const [{ data: existing }, { data: photos }, { data: orgRow }, { data: requested }] = await Promise.all([
    sb.from("social_posts").select("job_id").in("job_id", ids),
    sb.from("job_photos").select("id, job_id, kind, zone_id, zone_name, created_at").in("job_id", ids).in("kind", ["before", "after"]),
    sb.from("organizations").select("business_phone").eq("id", org).maybeSingle(),
    sb.from("job_requested_services").select("job_id, service_type_id").in("job_id", ids),
  ]);
  const posted = new Set(((existing ?? []) as { job_id: string | null }[]).map((e) => e.job_id));
  const phone = (orgRow as { business_phone?: string | null } | null)?.business_phone || DEFAULT_PHONE;
  const typeIds = [...new Set(((requested ?? []) as { service_type_id: string }[]).map((r) => r.service_type_id))];
  const { data: services } = typeIds.length
    ? await sb.from("services").select("service_type_id, name").eq("organization_id", org).in("service_type_id", typeIds)
    : { data: [] };
  const nameOf = new Map(((services ?? []) as { service_type_id: string; name: string }[]).map((s) => [s.service_type_id, s.name]));

  const booked = rows.map((r) => r.scheduled_for).filter((s): s is string => Boolean(s));
  for (const job of candidates) {
    if (posted.has(job.id) || result.made >= 2) continue;
    const jobPhotos = ((photos ?? []) as { id: string; job_id: string; kind: PhotoKind; zone_id: string | null; zone_name: string | null; created_at: string }[]).filter((p) => p.job_id === job.id);
    const pair = pairPhotos(jobPhotos)[0];
    if (!pair) continue;
    const slot = nextCappedSlot(booked, settings.socialPostsPerWeek, now);
    if (!slot) break;
    const town = townFromAddress(job.properties?.address ?? null);
    const servicesFor = ((requested ?? []) as { job_id: string; service_type_id: string }[])
      .filter((r) => r.job_id === job.id)
      .map((r) => nameOf.get(r.service_type_id))
      .filter((n): n is string => Boolean(n))
      .slice(0, 2);
    const caption = suggestCaption({ services: servicesFor, zoneName: null, city: town, phone });
    const { error } = await sb.from("social_posts").insert({
      organization_id: org,
      job_id: job.id,
      before_photo_id: pair.before.id,
      after_photo_id: pair.after.id,
      zone_id: pair.zoneId,
      zone_name: pair.zoneName,
      kind: "before-after",
      card_style: "split",
      hook: town ? `Before & after in ${town}` : "Before & after",
      body: caption,
      caption,
      plan_day: localDay(slot),
      status: "scheduled",
      scheduled_for: slot.toISOString(),
      placement: "page",
      auto_source: "crew_photos",
      approved_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    if (error) {
      // The pair is already a post (unique pair), or the table refused it.
      continue;
    }
    booked.push(slot.toISOString());
    posted.add(job.id);
    result.made++;
  }
  return result;
}
