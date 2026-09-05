import { redirect } from "next/navigation";

// Alerts are a tab on My Day now — personal settings on the personal screen.
// Kept as a redirect so the old link still works.
export default function NotificationsRedirect() {
  redirect("/my-day");
}
