import { isSupabaseConfigured } from "@/lib/env";
import { requireAnyTab } from "@/lib/data/access";
import { loadBoard } from "@/lib/data/comms-board";
import { LiveBoard } from "@/components/comms-board/live-board";

/**
 * The Communications Board: every message from every channel, one card per
 * person, from Backlog to sent. Opens to whoever can open the Conversations
 * inbox it is linked from.
 */
export const dynamic = "force-dynamic";

export default async function CommsBoardPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }
  await requireAnyTab(["conversations"], "/conversations");
  const { cards, needsMigration } = await loadBoard();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return <LiveBoard cards={cards} today={today} needsMigration={needsMigration} />;
}
