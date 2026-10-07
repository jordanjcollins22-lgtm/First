import { redirect } from "next/navigation";

// The crew sheet and the crew in the field are one thing: every page of the
// job on site is at /practice/crew. Kept as a redirect so old links land.
export default function CrewSheetRedirect() {
  redirect("/practice/crew");
}
