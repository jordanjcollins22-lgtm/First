/**
 * A careers link that keeps ?org= and ?src= as the applicant moves from the
 * list to a job, so an application from an Indeed ad is still counted as one.
 */
export function careersHref(path: string, keep: { org: string | null; src: string | null }): string {
  const params = new URLSearchParams();
  if (keep.org) params.set("org", keep.org);
  if (keep.src) params.set("src", keep.src);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
