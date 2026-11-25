import { v2RolesOf } from "@/lib/v2-roles";
import type { Profile } from "@/types/domain";

export type MeScreen = "owner" | "account-manager" | "technician" | "affiliate" | "partner";
const SCREENS: MeScreen[] = ["owner", "account-manager", "technician", "affiliate", "partner"];

/**
 * Which role's home a person sees. The owner can open any role's with
 * ?role=, filled with their own data; everyone else gets their own.
 */
export function meScreenFor(profile: Profile, asked?: string): MeScreen | null {
  const roles = v2RolesOf(profile);
  if (roles.includes("owner")) return SCREENS.includes(asked as MeScreen) ? (asked as MeScreen) : "owner";
  if (roles.includes("account-manager")) return "account-manager";
  if (roles.includes("project-lead") || roles.includes("project-technician")) return "technician";
  if (roles.includes("affiliate")) return "affiliate";
  return null;
}
