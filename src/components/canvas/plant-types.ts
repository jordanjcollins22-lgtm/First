export interface PlantType {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

export const PLANT_TYPES: PlantType[] = [
  { id: "tree", label: "Tree", emoji: "🌳", color: "#15803d" },
  { id: "shrub", label: "Shrub", emoji: "🌿", color: "#16a34a" },
  { id: "flower", label: "Flower", emoji: "🌸", color: "#db2777" },
  { id: "grass", label: "Grass / Sod", emoji: "🌱", color: "#65a30d" },
  { id: "mulch", label: "Mulch Bed", emoji: "🪵", color: "#92400e" },
  { id: "rock", label: "Rock / Stone", emoji: "🪨", color: "#57534e" },
];

export function plantTypeById(id: string): PlantType | undefined {
  return PLANT_TYPES.find((plant) => plant.id === id);
}

export const PLANT_DRAG_MIME = "application/x-plant-type";
