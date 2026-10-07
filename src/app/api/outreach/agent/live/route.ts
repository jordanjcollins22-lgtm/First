import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { checkTabAccess } from "@/lib/data/access";
import { getFinderLive } from "@/lib/data/finder-live";

/** What the finder is doing right now. Polled by the live card on Where Posts Come From. */
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { allowed } = await checkTabAccess("group-agent").catch(() => ({ allowed: false }));
  if (!allowed) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  return NextResponse.json(await getFinderLive(profile.organization_id));
}
