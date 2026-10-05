"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { listScheduledTimes } from "@/lib/data/social";
import { describeSlot, nextPostSlot } from "@/lib/social-post";
import { adoptEvaluationPhotosAsBefores } from "@/lib/data/adopt-befores";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env, isAnthropicConfigured } from "@/lib/env";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { serviceLabelFor } from "@/lib/zone-scope";
import { formatMeasurements, zoneMaterialLineItems, zoneMeasurements } from "@/lib/proposal-pricing";
import { recordOutreach } from "@/lib/actions/outreach-link-actions";
import { outboundBaseUrl } from "@/lib/base-url";
import type { WorkZone } from "@/components/canvas/types";
import {
  areaFromAddress,
  CaptionSchema,
  captionBrief,
  captionProblems,
  captionSystemPrompt,
  composeCaption,
  describeArea,
  fallbackCaption,
  privateTermsFor,
  scrubCaption,
} from "@/lib/social-caption";
import { MEASURED_BY_KEY } from "@/lib/measured-by";

/** The business line, when none is saved on the organization. */
const DEFAULT_PHONE = "443-819-1521";

export type SocialResult =
  | { ok: true; message?: string; scheduledFor?: string }
  | { ok: false; message: string };

/**
 * Approves a pair and gives it a time.
 *
 * Approval and scheduling are one press on purpose. Somebody looking at a
 * finished square has already made the only decision that matters; making
 * them pick a date as well is how a queue fills up with approved posts nobody
 * ever sent.
 *
 * The slot is chosen against everything already booked, so approving five in
 * one sitting spreads them over a fortnight.
 */
export async function approveSocialPost(input: {
  jobId: string;
  beforePhotoId: string;
  afterPhotoId: string;
  zoneId?: string | null;
  zoneName?: string | null;
  imagePath: string;
  caption: string;
}): Promise<SocialResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!input.imagePath) return { ok: false, message: "The image hasn't finished uploading." };

    const [supabase, organizationId, booked] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
      listScheduledTimes(),
    ]);

    const slot = nextPostSlot(booked);
    if (!slot) return { ok: false, message: "No free slot in the next three months." };

    const now = new Date().toISOString();
    const { error } = await supabase.from("social_posts").upsert(
      {
        organization_id: organizationId,
        job_id: input.jobId,
        before_photo_id: input.beforePhotoId,
        after_photo_id: input.afterPhotoId,
        zone_id: input.zoneId ?? null,
        zone_name: input.zoneName ?? null,
        image_path: input.imagePath,
        caption: input.caption.trim() || null,
        status: "scheduled",
        scheduled_for: slot.toISOString(),
        approved_by: profile.id,
        approved_at: now,
        updated_at: now,
      },
      { onConflict: "before_photo_id,after_photo_id" }
    );

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/social");
    revalidatePath(`/jobs/${input.jobId}`);

    return {
      ok: true,
      scheduledFor: slot.toISOString(),
      message: `Approved, goes out ${describeSlot(slot)}.`,
    };
  } catch (err) {
    console.error("approveSocialPost failed:", err);
    return { ok: false, message: "Couldn't approve that one." };
  }
}

/**
 * Turns a pair down for good.
 *
 * Recorded rather than ignored, so the same photograph nobody wants to post
 * does not come back to the top of the list every week.
 */
export async function skipSocialPost(input: {
  jobId: string;
  beforePhotoId: string;
  afterPhotoId: string;
}): Promise<SocialResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { error } = await supabase.from("social_posts").upsert(
      {
        organization_id: organizationId,
        job_id: input.jobId,
        before_photo_id: input.beforePhotoId,
        after_photo_id: input.afterPhotoId,
        status: "skipped",
        approved_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "before_photo_id,after_photo_id" }
    );

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/social");
    return { ok: true, message: "Won't be offered again." };
  } catch (err) {
    console.error("skipSocialPost failed:", err);
    return { ok: false, message: "Couldn't skip that one." };
  }
}

/** Moves a scheduled post to a different time. */
export async function reschedulePost(id: string, when: string): Promise<SocialResult> {
  try {
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) return { ok: false, message: "That isn't a time." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("social_posts")
      .update({ scheduled_for: at.toISOString(), status: "scheduled", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/social");
    return { ok: true, message: `Moved to ${describeSlot(at)}.` };
  } catch (err) {
    console.error("reschedulePost failed:", err);
    return { ok: false, message: "Couldn't move that one." };
  }
}

/** Records that a post went out — by hand, or by whatever sends it. */
export async function markPosted(id: string, channel?: string): Promise<SocialResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("social_posts")
      .update({
        status: "posted",
        posted_at: new Date().toISOString(),
        channel: channel ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("job_id")
      .maybeSingle();

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/social");
    if (data?.job_id) revalidatePath(`/jobs/${data.job_id}`);

    return { ok: true, message: "Marked as posted." };
  } catch (err) {
    console.error("markPosted failed:", err);
    return { ok: false, message: "Couldn't mark that one." };
  }
}

/**
 * Takes an already-submitted job's evaluation photos as its befores.
 *
 * New evaluations do this on submission. This is the same thing for the ones
 * that went through before it did — the pictures are sitting there either
 * way, and a job with a folder of before photos should not be on a list of
 * jobs with none.
 */
export async function adoptBeforesForJob(jobId: string): Promise<SocialResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const { adopted, attempted, lastError } = await adoptEvaluationPhotosAsBefores(jobId);

    revalidatePath("/admin/social");
    revalidatePath(`/jobs/${jobId}`);

    if (adopted > 0) {
      return {
        ok: true,
        message: `Took ${adopted} evaluation photo${adopted === 1 ? "" : "s"} as befores.`,
      };
    }

    // "Nothing to do" and "everything failed" look identical from a count, so
    // they are told apart here rather than both reported as an empty shrug.
    if (attempted === 0) {
      return { ok: false, message: "No zone photos on that evaluation to use." };
    }

    return {
      ok: false,
      message: `Found ${attempted} evaluation photo${attempted === 1 ? "" : "s"} but couldn't copy ${
        attempted === 1 ? "it" : "them"
      }${lastError ? `: ${lastError}` : "."}`,
    };
  } catch (err) {
    console.error("adoptBeforesForJob failed:", err);
    return { ok: false, message: "Couldn't use those photos." };
  }
}

export type CaptionResult =
  | { ok: true; caption: string; link: string; note?: string }
  | { ok: false; message: string };

/**
 * Write the caption for a before-and-after: Hook, Meat, CTA, SEO.
 *
 * From what was done in that area (the service, its materials and colour,
 * its size, off the site map) and where (the town and zip, nothing
 * narrower). The writer is never given the client's name or the street, and
 * what comes back is scrubbed of them and checked for claims we cannot make.
 *
 * The call to action carries a tracked link of its own, so a booking that
 * came from the post counts back to it. Pass it back on a rewrite to keep
 * the same one.
 */
export async function writeSocialCaption(input: {
  jobId: string;
  zoneId?: string | null;
  zoneName?: string | null;
  link?: string | null;
}): Promise<CaptionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };

  const supabase = await createClient();
  const [{ data: job }, design, catalog, organization] = await Promise.all([
    supabase
      .from("jobs")
      .select("name, property:properties(address, customer:customers(name))")
      .eq("id", input.jobId)
      .maybeSingle(),
    getCanvasDesignForJob(input.jobId).catch(() => null),
    getCanvasCatalog().catch(() => null),
    getCurrentOrganization(),
  ]);
  const property = (job as unknown as { property: { address: string | null; customer: { name: string | null } | null } | null } | null)?.property;
  const address = property?.address ?? null;
  const area = areaFromAddress(address);
  const privateTerms = privateTermsFor(property?.customer?.name, address);
  const phone = (organization as unknown as { business_phone?: string | null }).business_phone?.trim() || DEFAULT_PHONE;

  // What was done in this area, off the site map.
  const zones = ((design?.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service);
  const zone = zones.find((z) => z.id === input.zoneId) ?? zones.find((z) => z.name === input.zoneName) ?? zones[0] ?? null;
  const pricingRow = zone?.service && catalog ? catalog.servicePricing.find((p) => p.service_type_id === zone.service!.typeId) : undefined;
  const def = zone?.service ? serviceTypeById(zone.service.typeId) : undefined;
  const service = zone?.service
    ? serviceLabelFor(def, pricingRow ? { name: pricingRow.name, scopeTemplate: pricingRow.scope_template } : undefined) || "Landscaping"
    : "Landscaping";
  const measured = zone ? zoneMeasurements(zone) : null;
  const materials = zone && catalog ? zoneMaterialLineItems(zone, measured?.areaSqFt ?? 0, catalog).map((m) => m.material) : [];
  const answers = Object.entries(zone?.service?.values ?? {})
    .filter(([k, v]) => k !== MEASURED_BY_KEY && typeof v === "string" && v.trim() && v.length <= 60)
    .slice(0, 6)
    .map(([k, v]) => `${k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${v}`);
  const details = [...new Set(materials)].map((m) => `material: ${m}`).concat(answers);

  // The tracked link: kept across rewrites, minted once.
  let link = input.link?.trim() || "";
  if (!link) {
    const recorded = await recordOutreach({
      kind: "post",
      platform: "facebook",
      audience: "Our page",
      fromPage: organization.name,
      sentTo: "",
      service,
      note: `Before and after, ${describeArea(area)}`,
      screenshotPath: null,
    });
    link = recorded.ok ? recorded.link : `${await outboundBaseUrl()}/book`;
  }

  const fallback = () => fallbackCaption({ service, area, phone, bookingUrl: link });
  if (!isAnthropicConfigured) return { ok: true, caption: scrubCaption(fallback(), privateTerms), link, note: "Written from the template: the writer isn't set up on this site." };

  try {
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: betaZodOutputFormat(CaptionSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: captionSystemPrompt(organization.name),
      messages: [{ role: "user", content: captionBrief({ service, details, sizeLabel: measured ? formatMeasurements(measured, zone!) : null, area, phone, bookingUrl: link }) }],
    });
    const parts = response.stop_reason === "refusal" ? null : response.parsed_output;
    if (!parts) return { ok: true, caption: scrubCaption(fallback(), privateTerms), link, note: "Written from the template this time." };
    const caption = scrubCaption(composeCaption(parts), privateTerms);
    const problems = captionProblems(caption, privateTerms);
    if (problems.length) {
      console.error("social caption refused:", problems);
      return { ok: true, caption: scrubCaption(fallback(), privateTerms), link, note: `Written from the template: the draft ${problems.join(" ").toLowerCase()}` };
    }
    // The link and number have to survive the writing.
    const withLink = caption.includes(link) ? caption : `${caption}\n\n${link}`;
    return { ok: true, caption: withLink, link };
  } catch (err) {
    console.error("writeSocialCaption failed:", err);
    return { ok: true, caption: scrubCaption(fallback(), privateTerms), link, note: "Written from the template: the writer couldn't be reached." };
  }
}
