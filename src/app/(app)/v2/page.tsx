import { redirect } from "next/navigation";

/** The new layout opens on Marketing, the first of its four pages. */
export default function V2Home() {
  redirect("/v2/marketing");
}
