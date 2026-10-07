/**
 * Who changes tools, kits and their photos: the owner, and anybody the owner
 * has allowed. Everybody else sees them and loads the truck from them.
 *
 * The database is what enforces it (public.can_edit_tools(), migration 0331,
 * by the email somebody signs in with). This is the same rule for the screens,
 * so a person who can't change something is told so instead of watching a
 * save quietly do nothing.
 */

/** The owner's sign-in emails. Kept in step with public.is_tools_owner(). */
export const TOOLS_OWNER_EMAILS = ["jordan@jslandscapingmd.com", "jordanjcollins22@gmail.com"];

export const NOT_A_TOOL_EDITOR = "Only Jordan, or somebody Jordan allows, can change tools, kits and their photos.";

export function isToolsOwner(email: string | null | undefined): boolean {
  return TOOLS_OWNER_EMAILS.includes((email ?? "").trim().toLowerCase());
}

export function canEditTools(profile: { email?: string | null; can_edit_tools?: boolean | null } | null | undefined): boolean {
  if (!profile) return false;
  return isToolsOwner(profile.email) || Boolean(profile.can_edit_tools);
}
