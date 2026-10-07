"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { reviewSourceFrom } from "@/lib/review-import";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStudioShowcase, studioPostId } from "@/lib/data/booking-proof";

type ProofUpdate = Database["public"]["Tables"]["booking_proof"]["Update"];

/**
 * The owner entering what the booking page shows: real reviews, word for
 * word, and the real news story. Owner only, because this is what the
 * business says about itself to every stranger who clicks a link.
 */

type Result = { ok: true; id?: string } | { ok: false; error: string };

async function owner() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." } as const;
  if (!isOwnerLevel(profile.roles)) return { error: "Only the owner can change the booking page." } as const;
  return { profile } as const;
}

function cleanUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function saveReview(input: {
  id?: string | null;
  author: string;
  body: string;
  stars: number | null;
  source: string;
  writtenOn: string | null;
}): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const author = input.author.trim().slice(0, 80);
  const body = input.body.trim().slice(0, 1500);
  if (!author || !body) return { ok: false, error: "A review needs the name and what they said." };
  const stars = input.stars && input.stars >= 1 && input.stars <= 5 ? Math.round(input.stars) : null;
  const row = {
    author,
    body,
    stars,
    source: input.source.trim().slice(0, 40) || null,
    written_on: input.writtenOn || null,
    updated_at: new Date().toISOString(),
  };
  return write(who.profile.organization_id, who.profile.id, "review", input.id ?? null, row);
}

export async function saveNews(input: { id?: string | null; outlet: string; headline: string; url: string }): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const outlet = input.outlet.trim().slice(0, 80);
  const headline = input.headline.trim().slice(0, 200);
  if (!outlet || !headline) return { ok: false, error: "A news story needs the outlet and the headline." };
  const url = cleanUrl(input.url);
  if (input.url.trim() && !url) return { ok: false, error: "That link doesn't look right." };
  return write(who.profile.organization_id, who.profile.id, "news", input.id ?? null, {
    outlet,
    headline,
    url,
    updated_at: new Date().toISOString(),
  });
}

async function write(
  organizationId: string,
  profileId: string,
  kind: "review" | "news",
  id: string | null,
  row: ProofUpdate
): Promise<Result> {
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("booking_proof").update(row).eq("id", id).eq("organization_id", organizationId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/booking-page");
    return { ok: true, id };
  }
  // New ones go at the end.
  const { count } = await supabase
    .from("booking_proof")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("kind", kind);
  const { data, error } = await supabase
    .from("booking_proof")
    .insert({ ...row, organization_id: organizationId, kind, position: count ?? 0, created_by: profileId })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true, id: data.id };
}

export async function setProofShown(id: string, shown: boolean): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const supabase = await createClient();
  const { error } = await supabase
    .from("booking_proof")
    .update({ shown, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true };
}

export async function deleteProof(id: string): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("booking_proof")
    .select("external_key")
    .eq("id", id)
    .eq("organization_id", who.profile.organization_id)
    .maybeSingle();
  // A pulled review that is deleted stays deleted: the next pull would
  // otherwise bring it straight back.
  if (row?.external_key) {
    await supabase
      .from("booking_proof_dismissed")
      .upsert({ organization_id: who.profile.organization_id, external_key: row.external_key }, { onConflict: "organization_id,external_key" });
  }
  const { error } = await supabase.from("booking_proof").delete().eq("id", id).eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true };
}

/**
 * A Facebook page or Google listing to pull reviews from. Saving it asks for
 * a pull straight away; one per platform, so pasting a new Facebook link
 * replaces the old one.
 */
export async function saveReviewSource(link: string): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const check = reviewSourceFrom(link);
  if (!check.ok) return { ok: false, error: check.error };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("booking_review_sources").upsert(
    {
      organization_id: who.profile.organization_id,
      platform: check.platform,
      url: check.url,
      pull_requested_at: now,
      created_by: who.profile.id,
      updated_at: now,
    },
    { onConflict: "organization_id,platform" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true };
}

/** Ask the extension to read every saved page again now. */
export async function requestReviewPull(): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("booking_review_sources")
    .update({ pull_requested_at: now, updated_at: now })
    .eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true };
}

export async function removeReviewSource(id: string): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const supabase = await createClient();
  const { error } = await supabase.from("booking_review_sources").delete().eq("id", id).eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true };
}

/** Moves one up or down its list, swapping places with its neighbour. */
export async function moveProof(id: string, direction: -1 | 1): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const supabase = await createClient();
  const { data: me } = await supabase
    .from("booking_proof")
    .select("id, kind")
    .eq("id", id)
    .eq("organization_id", who.profile.organization_id)
    .maybeSingle();
  if (!me) return { ok: false, error: "That one is gone." };
  const { data: list } = await supabase
    .from("booking_proof")
    .select("id")
    .eq("organization_id", who.profile.organization_id)
    .eq("kind", me.kind)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  const ids = (list ?? []).map((r) => r.id);
  const at = ids.indexOf(id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= ids.length) return { ok: true };
  [ids[at], ids[to]] = [ids[to], ids[at]];
  // Renumbered in full, so positions never collide however they were before.
  await Promise.all(ids.map((rowId, position) => supabase.from("booking_proof").update({ position }).eq("id", rowId)));
  revalidatePath("/admin/booking-page");
  return { ok: true };
}

/**
 * Show or hide one before-and-after on the booking page. A post from Before
 * & After Posts stays approved for social media either way.
 */
export async function setShowcaseShown(id: string, shown: boolean): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = isStudioShowcase(id)
    ? await supabase
        .from("social_posts")
        .update({ on_booking_page: shown, updated_at: now })
        .eq("id", studioPostId(id))
        .eq("organization_id", who.profile.organization_id)
    : await supabase.from("booking_showcase").update({ shown, updated_at: now }).eq("id", id).eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true };
}

/** Delete one uploaded here. One from Before & After Posts is hidden instead. */
export async function deleteShowcase(id: string): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  if (isStudioShowcase(id)) return { ok: false, error: "That one is from Before & After Posts. Hide it instead." };
  const supabase = await createClient();
  const { error } = await supabase.from("booking_showcase").delete().eq("id", id).eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true };
}

/**
 * A finished before-and-after picture, uploaded on the Booking Page. Shrunk
 * in the browser first; kept in the public social bucket, where only
 * approved work goes, since the owner uploading it is approving it.
 */
export async function addShowcase(form: FormData): Promise<Result> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error! };
  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim().slice(0, 60);
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the picture first." };
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, error: "That isn't a JPEG, PNG or WebP picture." };
  // Shrunk in the browser before it is sent, so anything this big did not go
  // through that.
  if (file.size > 1024 * 1024) return { ok: false, error: "That picture is too big. Try again, or a smaller one." };
  if (!title) return { ok: false, error: "Say what the job was, like \"Mulch & edging\"." };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${who.profile.organization_id}/booking/${crypto.randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("social-posts")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };
  const url = admin.storage.from("social-posts").getPublicUrl(path).data.publicUrl;

  const supabase = await createClient();
  const { count } = await supabase
    .from("booking_showcase")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", who.profile.organization_id);
  const { error } = await supabase.from("booking_showcase").insert({
    organization_id: who.profile.organization_id,
    title,
    image_url: url,
    position: count ?? 0,
    created_by: who.profile.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/booking-page");
  return { ok: true };
}
