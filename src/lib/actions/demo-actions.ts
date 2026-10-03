"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getRealProfile } from "@/lib/data/team";
import { clearViewAsProfileId, setViewAsProfileId } from "@/lib/impersonation";
import { DEMO_COOKIE } from "@/lib/demo-guard";

/**
 * Open the demo as somebody on the team: the whole app as they see it, with
 * live data, and nothing saved or sent until it is closed. Admins only.
 *
 * The cookie is readable by the page on purpose: the browser's own database
 * connection checks it too, so an upload from the phone is refused like one
 * from the server. Setting it by hand only ever takes something away.
 */
export async function openDemo(profileId: string) {
  const real = await getRealProfile();
  if (!real?.roles.includes("admin")) throw new Error("Only an admin can open the demo.");

  if (profileId !== real.id) {
    const supabase = await createClient();
    const { data: target } = await supabase.from("profiles").select("id, organization_id").eq("id", profileId).maybeSingle();
    if (!target || target.organization_id !== real.organization_id) throw new Error("That person isn't on your team.");
  }

  const store = await cookies();
  store.set(DEMO_COOKIE, "1", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  if (profileId === real.id) await clearViewAsProfileId();
  else await setViewAsProfileId(profileId);
  redirect("/my-day");
}

/** Close the demo: back to your own account, and back to the roles. */
export async function closeDemo() {
  const store = await cookies();
  store.delete(DEMO_COOKIE);
  await clearViewAsProfileId();
  redirect("/admin/demo");
}
