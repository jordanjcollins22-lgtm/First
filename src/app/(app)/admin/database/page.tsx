import { redirect } from "next/navigation";

// Database setup is a tab on Settings now. Kept as a redirect so old links and
// bookmarks still land somewhere.
export default function DatabaseRedirect() {
  redirect("/admin/settings");
}
