import type { EntityHandler } from "@/lib/entities/types";
import { ADMIN_ACCOUNT_HANDLERS } from "@/lib/entities/handlers/admin-accounts";
import { ADMIN_MONEY_HANDLERS } from "@/lib/entities/handlers/admin-money";
import { ADMIN_PEOPLE_HANDLERS } from "@/lib/entities/handlers/admin-people";
import { ADMIN_SETTINGS_HANDLERS } from "@/lib/entities/handlers/admin-settings";

/**
 * What can be opened and done from the Admin page's lists. Split by area:
 * oversight and customer accounts, money, people, and settings.
 */
export const ADMIN_HANDLERS: EntityHandler[] = [
  ...ADMIN_ACCOUNT_HANDLERS,
  ...ADMIN_MONEY_HANDLERS,
  ...ADMIN_PEOPLE_HANDLERS,
  ...ADMIN_SETTINGS_HANDLERS,
];
