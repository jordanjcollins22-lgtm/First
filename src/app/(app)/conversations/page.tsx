import { isSupabaseConfigured } from "@/lib/env";
import { listConversations } from "@/lib/data/conversations";
import { listTeamChannels } from "@/lib/data/team-channels";
import { getCurrentProfile } from "@/lib/data/team";
import { ConversationsView } from "@/components/conversations/conversations-view";
import type { TeamChannelWithMembers } from "@/types/domain";
import { AccessDeniedNotice } from "@/components/access-denied-notice";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { denied } = await searchParams;
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Sign in to see conversations.</p>
      </div>
    );
  }

  // Groups need migration 0066 — without it the client threads should still
  // load rather than taking the whole page down.
  const [conversations, channels] = await Promise.all([
    listConversations(),
    listTeamChannels().catch(() => [] as TeamChannelWithMembers[]),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <AccessDeniedNotice tab={denied} />
      <h1 className="mb-1 text-2xl font-bold">Conversations</h1>
      <p className="mb-6 text-muted-foreground">
        Internal team groups and notes, and every message sent to a client.
      </p>
      <ConversationsView
        conversations={conversations}
        channels={channels}
        currentProfileId={profile.id}
      />
    </div>
  );
}
