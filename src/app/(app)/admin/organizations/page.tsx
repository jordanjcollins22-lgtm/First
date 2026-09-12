import { redirect } from "next/navigation";

// Organizations is a tab on Settings now. Kept as a redirect so old links and
// bookmarks still land somewhere.
export default function OrganizationsRedirect() {
  redirect("/admin/settings");
}
