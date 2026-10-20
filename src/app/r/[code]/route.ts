import { serverEnv } from "@/lib/env";
import { landingUrlFor, normalizeAffiliateCode } from "@/lib/merch/affiliate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public target of every affiliate QR code. Credits the scan to the team
 * member who owns the code, then sends the visitor to the landing page.
 */
export async function GET(request: Request, ctx: RouteContext<"/r/[code]">) {
  const code = normalizeAffiliateCode((await ctx.params).code);
  if (!serverEnv.affiliateLandingUrl) {
    return new Response("This link isn't set up yet.", { status: 503 });
  }

  let ownerFound = false;
  try {
    const supabase = createAdminClient();
    const { data: member } = await supabase
      .from("team_members")
      .select("id")
      .eq("affiliate_code", code)
      .maybeSingle();
    ownerFound = Boolean(member);
    await supabase.from("affiliate_scans").insert({
      team_member_id: member?.id ?? null,
      affiliate_code: code,
      user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    });
  } catch (err) {
    // Never strand someone who scanned a truck because logging failed.
    console.error("[affiliate] scan logging failed", err);
  }

  return Response.redirect(landingUrlFor(serverEnv.affiliateLandingUrl, ownerFound ? code : null), 302);
}
