import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * The doors of one play, for looking at and editing: each with its
 * address, where it is, and how far it is from the house.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ playId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { playId } = await context.params;
  const supabase = await createClient();
  const { data: play, error: playError } = await supabase.from("marketing_plays").select("id, organization_id, kind, targets").eq("id", playId).maybeSingle();
  if (playError) return NextResponse.json({ error: playError.message }, { status: 500 });
  if (!play || play.organization_id !== profile.organization_id) return NextResponse.json({ error: "No such play." }, { status: 404 });
  if (play.kind === "flyers") {
    return NextResponse.json({ kind: play.kind, doors: [], routes: Array.isArray(play.targets) ? play.targets : [] }, { headers: { "cache-control": "no-store" } });
  }
  const { data, error } = await supabase.rpc("marketing_play_doors", { the_play: playId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ kind: play.kind, doors: Array.isArray(data) ? data : [], routes: [] }, { headers: { "cache-control": "no-store" } });
}
