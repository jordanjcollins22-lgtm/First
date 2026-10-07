import { getCurrentProfile } from "@/lib/data/team";
import { isFetchableImageUrl } from "@/lib/pasted-images";

/**
 * Fetch the picture a copied piece of a document was pointing at.
 *
 * Copying an image out of Google Docs, a web page or an email puts the HTML
 * that held it on the clipboard, not the image. The picture stays where it
 * was, named by address. The browser cannot go and get it: it is somebody
 * else's domain and the request is refused before it starts.
 *
 * So the server gets it. Which means the server is being handed an address off
 * somebody's clipboard and asked to open it, and that is worth being careful
 * about even when everybody who can do it is signed in and works here:
 *
 *  - Signed in, always. Nobody reaches this with a link.
 *  - Public web over https only, and never an address pointing back inside.
 *    Checked before the fetch and again on wherever it ended up, because a
 *    redirect is an address somebody else chose.
 *  - It has to answer with a picture. Anything else is not what was asked for.
 *  - Ten megabytes. A photograph is not bigger than that and a thing that is
 *    is not a photograph.
 */
export const dynamic = "force-dynamic";

/** Ten megabytes. Larger than any photograph and smaller than a problem. */
const MAX_BYTES = 10 * 1024 * 1024;

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return new Response("Sign in first.", { status: 401 });

  const target = new URL(request.url).searchParams.get("url") ?? "";
  if (!isFetchableImageUrl(target)) {
    return new Response("That is not an address we will fetch.", { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(15_000),
    });

    // Wherever a redirect landed is an address somebody else chose, so it is
    // checked like the one we were given.
    if (!upstream.ok || !isFetchableImageUrl(upstream.url || target)) {
      return new Response("Could not fetch that picture.", { status: 502 });
    }

    const type = upstream.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("image/")) {
      return new Response("That address is not a picture.", { status: 415 });
    }

    const declared = Number(upstream.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return new Response("That picture is too big.", { status: 413 });

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    // Checked again on what actually arrived: a content-length is a claim.
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      return new Response("That picture is too big.", { status: 413 });
    }

    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": type.split(";")[0].trim(),
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Could not fetch that picture.", { status: 502 });
  }
}
