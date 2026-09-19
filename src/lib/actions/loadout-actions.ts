"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { materialKey, type LoadoutKind } from "@/lib/loadout";
import { log } from "@/lib/log";

export type LoadoutResult = { ok: true; message?: string } | { ok: false; message: string };

const KINDS: LoadoutKind[] = ["kit", "tool", "material"];

/** Tick or untick one thing on today's load-out. Own list only. */
export async function toggleLoadoutItem(input: {
  day: string;
  kind: LoadoutKind;
  key: string;
  checked: boolean;
}): Promise<LoadoutResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!KINDS.includes(input.kind) || !input.key) return { ok: false, message: "That is not on the list." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return { ok: false, message: "Bad day." };

    const supabase = await createClient();
    if (input.checked) {
      const organizationId = await getCurrentOrganizationId();
      const { error } = await supabase.from("loadout_checks").upsert(
        {
          organization_id: organizationId,
          profile_id: profile.id,
          day: input.day,
          item_kind: input.kind,
          item_key: input.key,
        },
        { onConflict: "profile_id,day,item_kind,item_key" }
      );
      if (error) return { ok: false, message: describeDbError(error) };
    } else {
      const { error } = await supabase
        .from("loadout_checks")
        .delete()
        .eq("profile_id", profile.id)
        .eq("day", input.day)
        .eq("item_kind", input.kind)
        .eq("item_key", input.key);
      if (error) return { ok: false, message: describeDbError(error) };
    }
    revalidatePath("/my-day");
    return { ok: true };
  } catch (err) {
    log.error("loadout.toggle.failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "Couldn't save that tick. Try again." };
  }
}

/** What a visit needs brought, set from the job page. */
export async function setSessionBring(
  sessionId: string,
  input: { kits: number[]; toolIds: string[]; materials: string[] }
): Promise<LoadoutResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const kits = [...new Set(input.kits.filter((k) => Number.isInteger(k) && k > 0))].sort((a, b) => a - b);
    const toolIds = [...new Set(input.toolIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    const seen = new Set<string>();
    const materials = input.materials
      .map((m) => m.trim())
      .filter((m) => {
        const key = materialKey(m);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("job_work_sessions")
      .update({ kits, tool_ids: toolIds, materials, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .select("job_id")
      .maybeSingle();
    if (error) return { ok: false, message: describeDbError(error) };
    if (!data) return { ok: false, message: "Couldn't find that visit." };

    revalidatePath(`/jobs/${(data as { job_id: string }).job_id}`);
    revalidatePath("/my-day");
    return { ok: true, message: "Load list saved." };
  } catch (err) {
    log.error("loadout.bring.failed", { sessionId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "Couldn't save the load list." };
  }
}
