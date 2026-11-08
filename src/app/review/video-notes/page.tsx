import { notFound } from "next/navigation";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { VideoNotes } from "@/components/learn/video-notes";

/** Video notes on a preview build, working for real, for reviewing from the Flow Board. */
export const dynamic = "force-dynamic";

export default function ReviewVideoNotesPage() {
  if (!reviewPagesEnabled()) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold">Video notes</h1>
      <p className="mb-4 text-sm text-muted-foreground">Works for real here. In the app it&apos;s at /learn, for the owner.</p>
      <VideoNotes />
    </div>
  );
}
