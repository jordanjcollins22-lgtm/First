/** Distinct storage locations already in use, for the "Stored at" picker's
 * option list. There's no locations table — a storage location is just text
 * on the tool or material, so the list is whatever the business has already
 * typed.
 *
 * Lives here rather than beside the picker component because Server
 * Components call it: anything exported from a "use client" module becomes a
 * client reference on the server and throws when invoked there. */
export function storageLocationOptions(items: { storage_location: string | null }[]): string[] {
  return Array.from(
    new Set(items.map((item) => item.storage_location?.trim()).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b));
}
