import { notFound } from "next/navigation";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { SampleBoard } from "@/components/comms-board/sample-board";

/** The Communications Board on made-up people, for reviewing a preview. Saves and sends nothing. */
export const dynamic = "force-dynamic";

export default function ReviewCommsBoardPage() {
  if (!reviewPagesEnabled()) notFound();
  return <SampleBoard />;
}
