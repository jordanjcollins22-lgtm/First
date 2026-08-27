import { redirect } from "next/navigation";

// Proposals is a tab on Pipeline now — the pipeline, the quotes out on it and
// the people they belong to are one funnel looked at three ways. Kept as a
// redirect so old links and bookmarks still land somewhere.
export default function ProposalsRedirect() {
  redirect("/pipeline");
}
