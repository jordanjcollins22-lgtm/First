import { createClient } from "@/lib/supabase/server";

/** Someone an affiliate sent their link to, and whether they opened it. */
export interface ReferralRow {
  name: string;
  affiliation: string;
  sentAt: string;
  clicks: number;
  /** A screenshot of who they answered went with it. */
  screenshot?: boolean;
  /** Their tracked link's code, to find what they booked. */
  code?: string;
  /** How far they got: sent, opened, booked or sold, and the 4% once there's a price. */
  progress?: ReferralProgress;
  yours?: number | null;
}

export type ReferralProgress = "sent" | "opened" | "booked" | "sold" | "lost";

/** The people this affiliate sent their link to, newest first. Their own rows only. */
export async function myReferrals(organizationId: string, profileId: string): Promise<ReferralRow[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("outreach_links")
      .select("code, sent_to, audience, posted_at, click_count, screenshot_path")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .eq("via", "referral")
      .order("posted_at", { ascending: false })
      .limit(20);
    if (error) return [];
    return (data ?? []).map((r) => ({ name: r.sent_to ?? "Someone", affiliation: r.audience ?? "Other", sentAt: r.posted_at, clicks: r.click_count ?? 0, screenshot: !!r.screenshot_path, code: r.code }));
  } catch {
    return [];
  }
}
