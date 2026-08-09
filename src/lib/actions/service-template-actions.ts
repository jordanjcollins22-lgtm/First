"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { GeometryType, MeasurementType } from "@/types/domain";

export interface ServiceTemplateFormInput {
  name: string;
  description: string;
  allowedGeometryTypes: GeometryType[];
  requiredMeasurementType: MeasurementType;
  requiredPhotoCount: number;
  crewSteps: string[];
  toolsRequired: string[];
  equipmentRequired: string[];
  qualityControlRequirements: string[];
}

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function createServiceTemplate(formData: FormData) {
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Service name is required");

  const allowedGeometryTypes = formData.getAll("allowed_geometry_types") as string[];
  const requiredMeasurementType = String(formData.get("required_measurement_type"));

  const { error } = await supabase.from("service_templates").insert({
    name,
    description: String(formData.get("description") ?? ""),
    allowed_geometry_types: allowedGeometryTypes,
    required_measurement_type: requiredMeasurementType,
    required_photo_count: Number(formData.get("required_photo_count") ?? 0),
    crew_steps: linesToArray(String(formData.get("crew_steps") ?? "")),
    tools_required: linesToArray(String(formData.get("tools_required") ?? "")),
    equipment_required: linesToArray(String(formData.get("equipment_required") ?? "")),
    quality_control_requirements: linesToArray(
      String(formData.get("quality_control_requirements") ?? "")
    ),
    materials_formula: [],
    estimator_questions: [],
    before_photo_requirements: [],
    after_photo_requirements: [],
  });
  if (error) throw error;

  revalidatePath("/admin/service-templates");
}

export async function deactivateServiceTemplate(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("service_templates")
    .update({ active: false })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/service-templates");
}
