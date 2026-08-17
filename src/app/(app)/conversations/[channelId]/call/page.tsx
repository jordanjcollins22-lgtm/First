import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { isLivekitConfigured, isSupabaseConfigured } from "@/lib/env";
import { getTeamChannel } from "@/lib/data/team-channels";
import { getCurrentProfile } from "@/lib/data/team";
import { GroupCall } from "@/components/calls/group-call";
import { requireTab } from "@/lib/data/access";

// Internal only — a call belongs to a team group, and nothing client-facing
// links here.
export default async function GroupCallPage({ params }: { params: Promise<{ channelId: string }> }) {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }
  await requireTab("conversation-call", "/conversations");

  const { channelId } = await params;
  const [profile, data] = await Promise.all([getCurrentProfile(), getTeamChannel(channelId)]);
  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Sign in to join this call.</p>
      </div>
    );
  }
  if (!data) notFound();

  const isMember = data.channel.memberIds.includes(profile.id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <Link
        href={`/conversations/${channelId}`}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {data.channel.name}
      </Link>

      {!isLivekitConfigured ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-4 text-sm">
          Video calling isn&apos;t set up on the server yet. Add <code>NEXT_PUBLIC_LIVEKIT_URL</code>,{" "}
          <code>LIVEKIT_API_KEY</code>, and <code>LIVEKIT_API_SECRET</code> from a LiveKit Cloud project to
          enable it.
        </div>
      ) : !isMember ? (
        <div className="rounded-lg border border-border bg-card/60 p-4 text-sm text-muted-foreground">
          You need to be a member of {data.channel.name} to join its call. Add yourself from the group page.
        </div>
      ) : (
        <GroupCall channelId={channelId} channelName={data.channel.name} />
      )}
    </div>
  );
}
