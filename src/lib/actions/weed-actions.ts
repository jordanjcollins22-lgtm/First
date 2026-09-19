"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const GUIDE = "/admin/weeds";

function failed(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/**
 * A photo added to a weed.
 *
 * The first one uploaded becomes the one that prints, because a weed with
 * photos and no print photo is a blank square on a sheet somebody has
 * already paid to have run off. It can be changed afterwards.
 */
export async function addWeedPhoto(input: {
  weedId: string;
  path: string;
  caption?: string | null;
  credit?: string | null;
}): Promise<ActionResult<{ id: string; printing: boolean }>> {
  try {
    const supabase = await createClient();
    const org = await getCurrentOrganizationId();
    const { count } = await supabase
      .from("weed_photos")
      .select("id", { count: "exact", head: true })
      .eq("weed_id", input.weedId);
    const { data, error } = await supabase
      .from("weed_photos")
      .insert({
        organization_id: org,
        weed_id: input.weedId,
        path: input.path,
        caption: input.caption ?? null,
        credit: input.credit ?? null,
        position: count ?? 0,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: weed } = await supabase.from("weeds").select("print_photo_id").eq("id", input.weedId).maybeSingle();
    const printing = !weed?.print_photo_id;
    if (printing) {
      const { error: setError } = await supabase
        .from("weeds")
        .update({ print_photo_id: data.id, updated_at: new Date().toISOString() })
        .eq("id", input.weedId);
      if (setError) throw setError;
    }
    revalidatePath(GUIDE);
    return { ok: true, value: { id: data.id as string, printing } };
  } catch (err) {
    return failed(err);
  }
}

/** Which of a weed's photos goes on paper. The rest stay for the screen. */
export async function setPrintPhoto(weedId: string, photoId: string | null): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("weeds")
      .update({ print_photo_id: photoId, updated_at: new Date().toISOString() })
      .eq("id", weedId);
    if (error) throw error;
    revalidatePath(GUIDE);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}

/**
 * A photo dropped.
 *
 * The file goes with the row: a bucket full of pictures nothing points at is
 * a bill nobody can explain. Where it was the print photo, the next one takes
 * over rather than the weed printing blank.
 */
export async function removeWeedPhoto(photoId: string): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient();
    const { data: photo, error: readError } = await supabase
      .from("weed_photos")
      .select("id, weed_id, path")
      .eq("id", photoId)
      .maybeSingle();
    if (readError) throw readError;
    if (!photo) return { ok: false, error: "That photo is already gone." };

    const { error } = await supabase.from("weed_photos").delete().eq("id", photoId);
    if (error) throw error;
    await supabase.storage.from("weed-photos").remove([photo.path as string]);

    const { data: weed } = await supabase
      .from("weeds")
      .select("print_photo_id")
      .eq("id", photo.weed_id as string)
      .maybeSingle();
    if (!weed?.print_photo_id) {
      const { data: next } = await supabase
        .from("weed_photos")
        .select("id")
        .eq("weed_id", photo.weed_id as string)
        .order("position")
        .limit(1)
        .maybeSingle();
      await supabase
        .from("weeds")
        .update({ print_photo_id: (next?.id as string) ?? null, updated_at: new Date().toISOString() })
        .eq("id", photo.weed_id as string);
    }
    revalidatePath(GUIDE);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}

/** Whether a weed is one the client sheet shows. */
export async function setOnClientSheet(weedId: string, on: boolean): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("weeds")
      .update({ on_client_sheet: on, updated_at: new Date().toISOString() })
      .eq("id", weedId);
    if (error) throw error;
    revalidatePath(GUIDE);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}

/**
 * What to do before treating this weed.
 *
 * Kept on the weed rather than in a checklist of its own, so the prep
 * booklet and the guide can never disagree about the same plant.
 */
export async function setWeedPrep(weedId: string, prep: string): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient();
    const trimmed = prep.trim();
    const { error } = await supabase
      .from("weeds")
      .update({ prep: trimmed === "" ? null : trimmed, updated_at: new Date().toISOString() })
      .eq("id", weedId);
    if (error) throw error;
    revalidatePath(GUIDE);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}
