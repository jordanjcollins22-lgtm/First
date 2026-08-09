/**
 * Auto-generates a structured scope of work for a WorkArea from its
 * ServiceTemplate + calculated measurements: crew steps, tools,
 * equipment, material quantities, and QC requirements. This is the
 * downstream consumer of the single-source-of-truth measurement module —
 * it never re-derives area/length itself.
 */
import type {
  CalculatedMeasurements,
  GeneratedScope,
  ServiceTemplate,
} from "@/types/domain";
import { formatMeasurement } from "@/lib/measurement";

function primaryQuantity(measurements: CalculatedMeasurements): number {
  switch (measurements.measurement_type) {
    case "area":
      return measurements.area_sqft ?? 0;
    case "length":
      return measurements.length_ft ?? 0;
    case "count":
      return measurements.point_count ?? 0;
    default:
      return 0;
  }
}

export function generateScope(
  workAreaId: string,
  template: ServiceTemplate,
  measurements: CalculatedMeasurements
): GeneratedScope {
  const quantity = primaryQuantity(measurements);

  const materials = template.materials_formula.map((formula) => {
    const rawQuantity = quantity / formula.coverage_per_unit;
    const wasteFactor = 1 + (formula.waste_factor_pct ?? 0) / 100;
    const withWaste = rawQuantity * wasteFactor;
    // Round up to a sensible purchasing increment (quarter-unit).
    const rounded = Math.ceil(withWaste * 4) / 4;
    return {
      material: formula.material,
      quantity: rounded,
      unit: formula.unit,
    };
  });

  return {
    work_area_id: workAreaId,
    service_template_name: template.name,
    measurement_summary: formatMeasurement(measurements),
    crew_steps: template.crew_steps,
    tools_required: template.tools_required,
    equipment_required: template.equipment_required,
    materials,
    quality_control_requirements: template.quality_control_requirements,
    generated_at: new Date().toISOString(),
  };
}
