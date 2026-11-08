import { notFound } from "next/navigation";

import { VideoNotes } from "@/components/learn/video-notes";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";

/**
 * Video notes: paste a YouTube link and get what you need from it without
 * watching. The owner's own tool.
 */
export const dynamic = "force-dynamic";

export default async function LearnPage() {
  const profile = await getCurrentProfile();
  if (!profile || !isOwnerLevel(profile.roles)) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold">Video notes</h1>
      <p className="mb-4 text-sm text-muted-foreground">Paste a YouTube link. Say what you know and what you want from it, and get what you learned without watching.</p>
      <VideoNotes />
    </div>
  );
}
