import { redirect } from "next/navigation";

// The journey map is a tab on the Dashboard now. Kept as a redirect so the
// old link still works.
export default function JourneysRedirect() {
  redirect("/dashboard");
}
