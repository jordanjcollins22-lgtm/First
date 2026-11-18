import { redirect } from "next/navigation";

/** The app's front door: everyone's own page. Signed out, the sign-in in front of it. */
export default function Home() {
  redirect("/me");
}
