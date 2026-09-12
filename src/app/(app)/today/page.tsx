import { redirect } from "next/navigation";

// The crew's day is what My Day shows a crew member — same question, same
// address, different answer. Kept as a redirect so the old link still works.
export default function TodayRedirect() {
  redirect("/my-day");
}
