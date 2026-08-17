import { redirect } from "next/navigation";

/**
 * Overhead is a tab on the Money page now.
 *
 * Kept as a redirect rather than deleted: the link is in people's history and
 * in the nav of anyone with an old page cached, and a dead link is a worse
 * answer than landing on the screen that took the job over.
 */
export default function OverheadPage() {
  redirect("/admin/payments");
}
