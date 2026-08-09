export type ServiceFieldType = "select" | "text" | "number";

export interface ServiceFieldDef {
  key: string;
  label: string;
  type: ServiceFieldType;
  options?: string[];
}

export interface ServiceTypeDef {
  id: string;
  label: string;
  fields: ServiceFieldDef[];
  /** Standard scope language auto-included for this service, if defined. */
  autoScope?: (values: Record<string, string>) => string;
}

const RAW_SERVICE_TYPES: ServiceTypeDef[] = [
  {
    id: "landscape-bed",
    label: "Landscape Bed",
    fields: [
      { key: "bedWork", label: "Bed work", type: "select", options: ["New Creation", "Renewal", "Existing Bed Maintenance"] },
      { key: "material", label: "Material", type: "select", options: ["Mulch", "Rock"] },
      { key: "existingMaterial", label: "Existing material", type: "select", options: ["None", "Mulch", "Rock"] },
      { key: "existingMaterialCondition", label: "Existing material condition", type: "select", options: ["Normal", "Excessive", "Needs Removal"] },
      { key: "weedLevel", label: "Weed level", type: "select", options: ["None", "Light", "Moderate", "Heavy"] },
      { key: "edge", label: "Edge", type: "select", options: ["Existing Good Edge", "Existing Edge Needs Redone", "No Edge"] },
      { key: "bushTrimming", label: "Bush trimming", type: "select", options: ["None", "Select Bushes", "All Bushes"] },
      { key: "bushRemoval", label: "Bush removal", type: "select", options: ["None", "Select Bushes", "All Bushes"] },
      { key: "plantRemoval", label: "Plant removal", type: "select", options: ["None", "Select Plants", "All Plants"] },
      { key: "plantRelocation", label: "Plant relocation", type: "select", options: ["None", "Select Plants"] },
      { key: "newPlantInstallation", label: "New plant installation", type: "select", options: ["None", "Select Plants"] },
    ],
    autoScope: () =>
      "Bed cleanup, weed removal, removal of excessive material, proper bed preparation, digging/redefining natural edges, debris disposal, correct material installation, and final cleanup.",
  },
  {
    id: "plant-bush-removal",
    label: "Plant / Bush Removal",
    fields: [
      { key: "type", label: "Type", type: "select", options: ["Plant", "Bush", "Ornamental Grass", "Small Sapling"] },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "size", label: "Size", type: "select", options: ["Small", "Medium", "Large", "Extra Large"] },
      { key: "afterward", label: "What happens afterward", type: "select", options: ["Return to Lawn", "Return to Landscape Bed", "New Plant Installed"] },
    ],
    autoScope: (values) => {
      let text =
        "Removal of plant material, removal of necessary root mass, hauling/disposal, filling the resulting hole with soil, compacting/leveling the disturbed area, and final cleanup.";
      if (values.afterward === "Return to Lawn") text += " Topsoil preparation and seed will be added.";
      else if (values.afterward === "Return to Landscape Bed") text += " The bed and its material will be restored.";
      else if (values.afterward === "New Plant Installed") text += " The hole will be prepared for the replacement plant.";
      return text;
    },
  },
  {
    id: "plant-installation",
    label: "Plant Installation",
    fields: [
      { key: "plant", label: "Plant", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "sizeContainer", label: "Size/container size", type: "text" },
      { key: "locationWithinZone", label: "Location within zone", type: "text" },
      { key: "installationType", label: "Installation type", type: "select", options: ["New installation", "Replacement"] },
    ],
    autoScope: () =>
      "Excavation, proper planting depth, soil preparation, backfilling, watering-in, surrounding bed restoration, debris removal, and cleanup.",
  },
  {
    id: "trimming",
    label: "Trimming",
    fields: [
      { key: "type", label: "Type", type: "select", options: ["Bush", "Hedge", "Ornamental Grass", "Small Tree"] },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "size", label: "Size", type: "select", options: ["Small", "Medium", "Large"] },
      { key: "condition", label: "Condition", type: "select", options: ["Maintenance", "Overgrown", "Severely Overgrown"] },
      { key: "desiredResult", label: "Desired result if specific", type: "text" },
    ],
    autoScope: () => "Proper trimming/pruning, debris collection, hauling, and cleanup.",
  },
  {
    id: "landscape-cleanup",
    label: "Landscape Cleanup",
    fields: [
      { key: "cleanupType", label: "Cleanup type", type: "select", options: ["General", "Overgrowth", "Property Reset"] },
      { key: "weedLevel", label: "Weed level", type: "select", options: ["Light", "Moderate", "Heavy"] },
      { key: "overgrowth", label: "Overgrowth", type: "select", options: ["Light", "Moderate", "Heavy"] },
      { key: "vines", label: "Vines", type: "select", options: ["None", "Light", "Heavy"] },
      { key: "saplings", label: "Saplings", type: "select", options: ["None", "Few", "Many"] },
      { key: "naturalDebris", label: "Natural debris", type: "select", options: ["Light", "Moderate", "Heavy"] },
      { key: "plantsStaying", label: "Any plants/bushes specifically staying?", type: "text" },
    ],
    autoScope: () => "Removal of designated unwanted growth/debris, cleanup, hauling/disposal, and final blow-off.",
  },
  {
    id: "lawn-restoration",
    label: "Lawn Restoration",
    fields: [
      { key: "condition", label: "Condition", type: "select", options: ["Bare", "Thin", "Damaged", "Landscape-to-Lawn Conversion"] },
      { key: "soilCondition", label: "Soil condition", type: "select", options: ["Good", "Needs Topsoil"] },
      { key: "grade", label: "Grade", type: "select", options: ["Good", "Needs Correction"] },
    ],
    autoScope: () => "Surface preparation, topsoil as required, grading, seed installation, and cleanup.",
  },
  {
    id: "grading",
    label: "Grading",
    fields: [
      { key: "purpose", label: "Purpose", type: "select", options: ["Drainage", "Leveling", "Repair", "Landscape-to-Lawn"] },
      { key: "severity", label: "Severity", type: "select", options: ["Minor", "Moderate", "Major"] },
      { key: "waterDirection", label: "Direction water needs to flow", type: "text" },
    ],
  },
  {
    id: "leaf-seasonal-cleanup",
    label: "Leaf / Seasonal Cleanup",
    fields: [
      { key: "type", label: "Type", type: "select", options: ["Leaf Cleanup", "Fall Cutback", "Full Fall Cleanup"] },
      { key: "leafVolume", label: "Leaf volume", type: "select", options: ["Light", "Moderate", "Heavy", "Extreme"] },
      { key: "grassesToCutBack", label: "Ornamental grasses/perennials to cut back?", type: "text" },
    ],
  },
  {
    id: "soft-washing",
    label: "Soft Washing",
    fields: [
      { key: "surface", label: "Surface", type: "select", options: ["House", "Fence", "Deck", "Patio", "Sidewalk", "Walkway", "Retaining Wall", "Other"] },
      { key: "materialType", label: "Material/surface type", type: "text" },
      { key: "condition", label: "Condition", type: "select", options: ["Light buildup", "Moderate buildup", "Heavy buildup"] },
      { key: "stainingAreas", label: "Special staining/problem areas?", type: "text" },
    ],
  },
];

// Every select field gets an "Other" option (with a free-text explanation the
// dialog asks for when it's chosen) so nothing forces a bad fit into a preset.
export const SERVICE_TYPES: ServiceTypeDef[] = RAW_SERVICE_TYPES.map((type) => ({
  ...type,
  fields: type.fields.map((field) =>
    field.type === "select" && field.options
      ? { ...field, options: Array.from(new Set([...field.options, "Other"])) }
      : field
  ),
}));

export function serviceTypeById(id: string): ServiceTypeDef | undefined {
  return SERVICE_TYPES.find((t) => t.id === id);
}
