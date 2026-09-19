import { redirect } from "next/navigation";

// Tools and Materials were merged into one Inventory page with a Tools/Materials
// toggle — keep this route working for old links/bookmarks.
export default function MaterialsRedirect() {
  redirect("/admin/tools");
}
