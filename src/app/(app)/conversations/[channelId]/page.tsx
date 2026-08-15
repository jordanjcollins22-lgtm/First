import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getTeamChannel } from "@/lib/data/team-channels";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { TeamChannelThread } from "@/components/conversations/team-channel-thread";

export default async function TeamChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  const { channelId } = await params;
  const [profile, data] = await Promise.all([getCurrentProfile(), getTeamChannel(channelId)]);
  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Sign in to see this group.</p>
      </div>
    );
  }
  if (!data) notFound();

  const profiles = await listProfiles();
  const teamMembers = profiles.map((p) => ({ id: p.id, name: p.full_name || p.email }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
      <Link href="/conversations" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to Conversations
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{data.channel.name}</h1>
        {data.channel.description && <p className="text-muted-foreground">{data.channel.description}</p>}
      </div>

      <TeamChannelThread
        channel={data.channel}
        messages={data.messages}
        currentProfileId={profile.id}
        teamMembers={teamMembers}
      />
    </div>
  );
}
