import { isSupabaseConfigured } from "@/lib/env";
import { getSubCrewSheet } from "@/lib/data/sub-crew";
import { SubCrewSheetView } from "@/components/crew/sub-crew-sheet";

/**
 * A subcontractor's crew sheet, by the link the office sent. No login: the
 * token opens this one visit and nothing else.
 */
export const dynamic = "force-dynamic";

export default async function SubCrewSheetPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured) return <p className="p-6">Not set up yet.</p>;
  const { token } = await params;
  const sheet = await getSubCrewSheet(token);
  if (!sheet) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-16 text-center">
        <p className="text-lg font-semibold">This crew sheet link isn&apos;t working.</p>
        <p className="text-sm text-muted-foreground">It may have been changed or the visit cancelled. Ask the office for a new link.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <SubCrewSheetView sheet={sheet} />
    </main>
  );
}
