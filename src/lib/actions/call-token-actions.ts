"use server";

import { AccessToken } from "livekit-server-sdk";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { env, isLivekitConfigured } from "@/lib/env";

export type CallTokenResult =
  | { ok: true; token: string; url: string; identity: string }
  | { ok: false; message: string };

/**
 * Mints a LiveKit token for one internal group's call room.
 *
 * Membership is checked here rather than trusted from the client: a room name
 * is guessable, so the token is the only thing standing between a group's
 * call and anyone else in the org. Calls are internal-only — nothing about
 * this is reachable from a client-facing page.
 */
export async function getCallToken(channelId: string): Promise<CallTokenResult> {
  try {
    if (!isLivekitConfigured) {
      return {
        ok: false,
        message: "Video calling isn't set up on the server yet — add the LiveKit keys to enable it.",
      };
    }

    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const { data: membership } = await supabase
      .from("team_channel_members")
      .select("profile_id")
      .eq("channel_id", channelId)
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (!membership) {
      return { ok: false, message: "You need to be a member of this group to join its call." };
    }

    const token = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
      identity: profile.id,
      name: profile.full_name || profile.email,
      // Long enough for a working session; re-issued on every join anyway.
      ttl: "4h",
    });
    token.addGrant({
      room: `group-${channelId}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // Carries the shared drawing strokes — no extra infrastructure needed.
      canPublishData: true,
    });

    return {
      ok: true,
      token: await token.toJwt(),
      url: env.livekitUrl,
      identity: profile.id,
    };
  } catch (err) {
    console.error("getCallToken failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't start that call." };
  }
}
