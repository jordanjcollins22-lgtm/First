/**
 * The four lists the Inventory page keeps, in one place both sides can read.
 *
 * Deliberately free of any database import. This is shared by a server data
 * module and by a client component, and the moment a value comes from the
 * same file as `createClient` the whole Supabase server module gets pulled
 * into the browser bundle.
 */

export type InventoryGroup = "materials" | "marketing" | "tools" | "gear";

export interface MaterialOption {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number | null;
  /** Which list on the Inventory page it lives on. */
  group: InventoryGroup;
  /** Which table it is in, because linking a node needs to know. */
  kind: "material" | "tool";
}

export const INVENTORY_GROUPS: { value: InventoryGroup; label: string; kind: "material" | "tool" }[] = [
  { value: "materials", label: "Materials", kind: "material" },
  { value: "marketing", label: "Marketing", kind: "material" },
  { value: "tools", label: "Tools", kind: "tool" },
  { value: "gear", label: "Crew Gear", kind: "tool" },
];
