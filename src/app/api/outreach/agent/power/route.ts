import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { pauseAgent } from "@/lib/data/outreach-agent";
import { isOwnerLevel } from "@/lib/roles";

/**
 * The finder's on and off switch, from the extension's popup.
 *
 * The same switch as Resume and Pause on Where Posts Come From: on, the
 * extension opens its window and keeps looking; off, it closes the window.
 * Owner only, signed in with the app's own cookies like every other call the
 * extension makes.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isOwnerLevel(profile.roles)) return NextResponse.json({ error: "Only the owner can turn the finder on or off." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { on?: unknown } | null;
  if (typeof body?.on !== "boolean") return NextResponse.json({ error: "Say on or off." }, { status: 400 });

  await pauseAgent(
    profile.organization_id,
    profile.id,
    body.on ? null : new Date("2099-01-01T00:00:00Z"),
    body.on ? null : "Turned off from the extension."
  );
  revalidatePath("/admin/outreach/agent");
  return NextResponse.json({ ok: true, on: body.on });
}
