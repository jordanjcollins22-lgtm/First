import { notFound } from "next/navigation";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { CrewJourney } from "@/components/practice/crew-journey";

/** The crew walkthrough with no sign-in, for reviewing a preview from the Flow Board. */
export const dynamic = "force-dynamic";

export default function ReviewCrewPage() {
  if (!reviewPagesEnabled()) notFound();
  return <CrewJourney />;
}
