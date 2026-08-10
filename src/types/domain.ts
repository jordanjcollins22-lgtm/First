/**
 * Core domain types. Mirrors the Supabase/Postgres schema in
 * supabase/migrations. Keep in sync manually (no codegen for MVP).
 */

import type { Feature, Geometry } from "geojson";

export type GeometryType = "Point" | "LineString" | "Polygon";

/** GeoJSON feature carrying only the geometry types Draw supports. */
export type WorkAreaGeometry = Feature<Geometry>;

export type MeasurementType = "area" | "length" | "count";

export interface CalculatedMeasurements {
  measurement_type: MeasurementType;
  area_sqft?: number;
  perimeter_ft?: number;
  length_ft?: number;
  point_count?: number;
  calculated_at: string;
  geometry_source: "original" | "cleaned";
  /** Version counter, bumped every time geometry changes after a lock. */
  version: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  customer_id: string;
  address: string;
  lat: number;
  lng: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type JobStatus = "estimating" | "quoted" | "approved" | "in_progress" | "completed" | "cancelled";

export interface Job {
  id: string;
  property_id: string;
  name: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
}

export interface Zone {
  id: string;
  job_id: string;
  name: string;
  auto_named: boolean;
  sequence_order: number | null;
  created_at: string;
  updated_at: string;
}

export type WorkAreaStatus = "draft" | "scoped" | "priced" | "approved" | "completed";

export interface WorkArea {
  id: string;
  job_id: string;
  zone_id: string | null;
  service_template_id: string;
  geometry: WorkAreaGeometry;
  cleaned_geometry: WorkAreaGeometry | null;
  calculated_measurements: CalculatedMeasurements | null;
  notes: string | null;
  sequence_order: number | null;
  status: WorkAreaStatus;
  /** Set once measurements have been used for a price sent to a customer. */
  geometry_locked_at: string | null;
  geometry_version: number;
  created_at: string;
  updated_at: string;
}

export interface EstimatorQuestion {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "select";
  options?: string[];
  required?: boolean;
}

export interface MaterialFormula {
  material: string;
  unit: string;
  /** Coverage rate used to derive quantity from measurement, e.g. sq ft per bag. */
  coverage_per_unit: number;
  waste_factor_pct?: number;
}

export interface ServiceTemplate {
  id: string;
  name: string;
  description: string | null;
  allowed_geometry_types: GeometryType[];
  required_measurement_type: MeasurementType;
  estimator_questions: EstimatorQuestion[];
  required_photo_count: number;
  crew_steps: string[];
  tools_required: string[];
  equipment_required: string[];
  materials_formula: MaterialFormula[];
  quality_control_requirements: string[];
  before_photo_requirements: string[];
  after_photo_requirements: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type PhotoStage = "before" | "after" | "reference";

export interface Photo {
  id: string;
  work_area_id: string;
  storage_path: string;
  stage: PhotoStage;
  caption: string | null;
  created_at: string;
}

export interface GeneratedScope {
  work_area_id: string;
  service_template_name: string;
  measurement_summary: string;
  crew_steps: string[];
  tools_required: string[];
  equipment_required: string[];
  materials: { material: string; quantity: number; unit: string }[];
  quality_control_requirements: string[];
  generated_at: string;
}

export interface Tool {
  id: string;
  name: string;
  icon: string;
  cost: number | null;
  is_rental: boolean;
  active: boolean;
  kit: string | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Material {
  id: string;
  name: string;
  unit: string;
  coverage_per_unit_sqft: number | null;
  waste_factor_pct: number;
  cost_per_unit: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceToolLink {
  service_type_id: string;
  tool_id: string;
}

export interface ServiceMaterialRule {
  id: string;
  service_type_id: string;
  material_id: string;
  match_field: string | null;
  match_value: string | null;
  created_at: string;
}

export interface ServicePricing {
  service_type_id: string;
  cost: number | null;
  cost_unit: string;
  estimated_hours: number | null;
  updated_at: string;
}

export interface CanvasDesignRow {
  id: string;
  job_id: string;
  address: string;
  image_path: string | null;
  image_x: number;
  image_y: number;
  image_scale: number;
  image_rotation: number;
  image_real_width_feet: number | null;
  locked: boolean;
  property_line: { x: number; y: number }[];
  zones: unknown[];
  created_at: string;
  updated_at: string;
}
