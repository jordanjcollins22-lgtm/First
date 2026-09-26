import { redirect } from "next/navigation";

/**
 * Link Tracking used to live here: a form to hand out a link by hand, and a
 * board of every link. Posts to Answer does both now -- the card writes the
 * comment with the link in it, and "Found a post?" takes one found by hand
 * -- so the old address, the browser button and old reminder emails land
 * there.
 */
export default function OutreachPage(): never {
  redirect("/admin/outreach/posts");
}
