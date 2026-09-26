import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { CONVERSATIONS_PAGE_SIZE, listConversations } from "@/lib/data/conversations";
import { listTeamChannels } from "@/lib/data/team-channels";
import { getCurrentProfile } from "@/lib/data/team";
import { ConversationsView } from "@/components/conversations/conversations-view";
import type { TeamChannelWithMembers } from "@/types/domain";
import { AccessDeniedNotice } from "@/components/access-denied-notice";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; show?: string }>;
}) {
  const { denied, show } = await searchParams;
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

  // How many conversations to read is in the URL rather than in state, so
  // that opening a thread and coming back does not silently collapse the list
  // somebody had just scrolled through. listConversations caps it.
  const [{ conversations, hasMore, pageSize }, channels] = await Promise.all([
    listConversations({ limit: show }),
    // Groups need migration 0066 — without it the client threads should still
    // load rather than taking the whole page down.
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

      {/* Older conversations are behind a tap rather than loaded with the
          page. The inbox is worked from the top, and reading every message
          the business has ever sent to render the bottom of a list nobody
          scrolls to is the cost that grows every day. */}
      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Link
            href={`/conversations?show=${pageSize + CONVERSATIONS_PAGE_SIZE}`}
            className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent/40"
          >
            Show older conversations
          </Link>
        </div>
      )}
    </div>
  );
}
