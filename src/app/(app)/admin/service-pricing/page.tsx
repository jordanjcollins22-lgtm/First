import { redirect } from "next/navigation";

// Team and Services were merged into one page with a Team/Services toggle —
// keep this route working for old links/bookmarks.
export default function ServicePricingRedirect() {
  redirect("/admin/team");
}
