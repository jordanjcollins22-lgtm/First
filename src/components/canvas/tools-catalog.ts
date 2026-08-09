/**
 * Default tool kits per service type. This is a reasonable starting point,
 * not a real inventory — swap these lists for the actual tool inventory
 * whenever it's available.
 */
export const SERVICE_TOOL_KITS: Record<string, string[]> = {
  "landscape-bed": ["Shovel", "Spade", "Bed Edger", "Rake", "Wheelbarrow", "Bed Blade", "Tarp", "Gloves"],
  "plant-bush-removal": ["Shovel", "Mattock", "Loppers", "Pruning Saw", "Root Saw", "Wheelbarrow", "Tarp"],
  "plant-installation": ["Shovel", "Trowel", "Wheelbarrow", "Hose", "Watering Can", "Gloves"],
  trimming: ["Hand Pruners", "Loppers", "Hedge Trimmer", "Pole Saw", "Tarp", "Gloves"],
  "landscape-cleanup": ["Rake", "Leaf Blower", "Loppers", "Wheelbarrow", "Tarp", "Trash Bags"],
  "lawn-restoration": ["Rake", "Spreader", "Aerator", "Topsoil Rake", "Wheelbarrow"],
  grading: ["Shovel", "Rake", "Landscape Rake", "Wheelbarrow", "Level", "Stakes & String"],
  "leaf-seasonal-cleanup": ["Leaf Blower", "Rake", "Tarp", "Loppers", "Trash Bags"],
  "soft-washing": ["Soft Wash System", "Extension Wand", "Chemical Sprayer", "Tarps", "Surface Cleaner", "Hose"],
};

export function defaultToolsForService(typeId: string): string[] {
  return SERVICE_TOOL_KITS[typeId] ?? [];
}

/** Best-effort icon per tool — approximate, not literal. Falls back to a toolbox. */
const TOOL_ICONS: Record<string, string> = {
  Shovel: "⛏️",
  Spade: "⛏️",
  "Bed Edger": "🔪",
  Rake: "🧹",
  Wheelbarrow: "🛒",
  "Bed Blade": "🔪",
  Tarp: "🧺",
  Tarps: "🧺",
  Gloves: "🧤",
  Mattock: "⛏️",
  Loppers: "✂️",
  "Pruning Saw": "🪚",
  "Root Saw": "🪚",
  Trowel: "🥄",
  Hose: "💧",
  "Watering Can": "🚿",
  "Hand Pruners": "✂️",
  "Hedge Trimmer": "✂️",
  "Pole Saw": "🪚",
  "Leaf Blower": "🌬️",
  "Trash Bags": "🗑️",
  Spreader: "🌱",
  Aerator: "🛠️",
  "Topsoil Rake": "🧹",
  "Landscape Rake": "🧹",
  Level: "📏",
  "Stakes & String": "🧵",
  "Soft Wash System": "🧽",
  "Extension Wand": "🧽",
  "Chemical Sprayer": "🧴",
  "Surface Cleaner": "🧽",
  "Stump Grinder": "🛠️",
  "Sod Cutter": "🛠️",
};

export function toolIcon(tool: string): string {
  return TOOL_ICONS[tool] ?? "🧰";
}

/** Equipment that's typically rented rather than kept in inventory. */
export const RENTAL_TOOLS = new Set(["Aerator", "Sod Cutter", "Stump Grinder"]);
