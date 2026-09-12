/**
 * Reading an embedded relationship without guessing its shape.
 *
 * PostgREST decides whether an embed comes back as an array or a single object
 * from the *constraints*, not from the query. `job_proposals` has a UNIQUE on
 * `job_id`, so `jobs(..., job_proposals(...))` returns one object; drop that
 * constraint and the identical query starts returning an array. Nothing in the
 * generated types distinguishes the two, so code written against one shape
 * compiles happily and then throws `.some is not a function` in production —
 * which is exactly how this function came to exist.
 *
 * So: never index or iterate an embed directly. Put it through here.
 */
export function embedded<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** The single row of a to-one embed, or null. */
export function embeddedOne<T>(value: T | T[] | null | undefined): T | null {
  return embedded(value)[0] ?? null;
}
