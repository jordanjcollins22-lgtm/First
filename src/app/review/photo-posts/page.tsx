import { notFound } from "next/navigation";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { outboundBaseUrl } from "@/lib/base-url";
import { PhotoPostSystemDemo } from "@/components/marketing/photo-post-system-demo";

/**
 * Photos into posts, the whole system, for reviewing on a preview without
 * signing in: the crew finishing a job, the photo backlog, the drafts being
 * written, Ready to approve, the scheduled week and what was posted. The
 * real screens with sample data; every button runs on the page only.
 * Nothing here reads or writes the database, uploads or posts anything.
 */
export const dynamic = "force-dynamic";

export default async function ReviewPhotoPostsPage() {
  if (!reviewPagesEnabled()) notFound();
  const bookingUrl = `${(await outboundBaseUrl()).replace(/\/$/, "")}/book`;
  return <PhotoPostSystemDemo now={new Date().toISOString()} bookingUrl={bookingUrl} />;
}
