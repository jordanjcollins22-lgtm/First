import type { EntityHandler } from "@/lib/entities/types";
import { MARKETING_HANDLERS } from "@/lib/entities/handlers/marketing";
import { SALES_HANDLERS } from "@/lib/entities/handlers/sales";
import { OPERATIONS_HANDLERS } from "@/lib/entities/handlers/operations";
import { ADMIN_HANDLERS } from "@/lib/entities/handlers/admin";

/** Every kind of thing a list row can open, by kind. */
const ALL: EntityHandler[] = [...MARKETING_HANDLERS, ...SALES_HANDLERS, ...OPERATIONS_HANDLERS, ...ADMIN_HANDLERS];

export const ENTITY_HANDLERS: Record<string, EntityHandler> = Object.fromEntries(ALL.map((h) => [h.kind, h]));
