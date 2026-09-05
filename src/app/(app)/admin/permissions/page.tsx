import { redirect } from "next/navigation";

// Permissions is a tab on Settings now. Kept as a redirect so old links and
// bookmarks still land somewhere.
export default function PermissionsRedirect() {
  redirect("/admin/settings");
}
