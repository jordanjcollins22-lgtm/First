/**
 * Core domain types. Mirrors the Supabase/Postgres schema in
 * supabase/migrations. Keep in sync manually (no codegen for MVP).
 */

export interface Organization {
  id: string;
  name: string;
  crew_cost_per_hour: number | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  organization_id: string;
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
  sqft: number | null;
  acreage: number | null;
  created_at: string;
  updated_at: string;
}

export type JobStatus = "estimating" | "quoted" | "approved" | "in_progress" | "completed" | "cancelled";

/** The evaluator's progress on a scheduled evaluation appointment — separate from JobStatus. */
export type EvaluationStatus = "scheduled" | "on_way" | "arrived" | "completed";

export interface Job {
  id: string;
  property_id: string;
  name: string;
  status: JobStatus;
  assigned_to: string | null;
  source_attractor_wave_id: string | null;
  evaluation_date: string | null;
  evaluation_status: EvaluationStatus;
  project_start_date: string | null;
  project_end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttractorType {
  id: string;
  label: string;
  is_system: boolean;
}

export interface AttractorVariant {
  id: string;
  type_id: string;
  name: string;
}

export type AttractorWaveStatus = "planned" | "ready" | "completed";
export type AttractorGeometryType = "point_radius" | "polygon" | "route" | "zip_list";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface AttractorGeometryPointRadius {
  lat: number;
  lng: number;
  radius_miles: number;
}

export interface AttractorGeometryPolygon {
  points: LatLng[];
}

export interface AttractorGeometryRoute {
  points: LatLng[];
  buffer_miles: number;
}

export interface AttractorGeometryZipList {
  zips: string[];
}

export type AttractorGeometry =
  | AttractorGeometryPointRadius
  | AttractorGeometryPolygon
  | AttractorGeometryRoute
  | AttractorGeometryZipList;

export interface AttractorWave {
  id: string;
  organization_id: string;
  type_id: string;
  variant_id: string | null;
  name: string;
  geometry_type: AttractorGeometryType;
  geometry: AttractorGeometry;
  date_planned: string | null;
  date_completed: string | null;
  quantity_deployed: number | null;
  status: AttractorWaveStatus;
  notes: string | null;
  leads_generated: number | null;
  projects_generated: number | null;
  revenue_generated: number | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessLocation {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  created_at: string;
  updated_at: string;
}

/** A location's areas reuse the same geometry shapes as attractor waves,
 * minus "route" — a service area isn't a path. */
export type LocationAreaGeometryType = Exclude<AttractorGeometryType, "route">;

export interface LocationArea {
  id: string;
  location_id: string;
  name: string;
  geometry_type: LocationAreaGeometryType;
  geometry: AttractorGeometry;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Role names are freeform now — managed in the "roles" table, not a fixed union. */
export type Role = string;

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  roles: Role[];
  organization_id: string;
  created_at: string;
  updated_at: string;
}

export interface CustomRole {
  name: string;
  is_system: boolean;
}

export interface RolePermission {
  role_name: string;
  tab_key: string;
}

export interface Tool {
  id: string;
  organization_id: string;
  name: string;
  icon: string;
  cost: number | null;
  is_rental: boolean;
  active: boolean;
  kits: number[];
  image_path: string | null;
  quantity: number | null;
  storage_location: string | null;
  shop_location: string | null;
  stock_method: "in_stock" | "order_as_needed";
  is_delivered: boolean;
  purchase_url: string | null;
  how_to_url: string | null;
  reorder_threshold: number | null;
  on_order: boolean;
  not_owned_reason: string | null;
  cost_to_own: number | null;
  created_at: string;
  updated_at: string;
}

export interface Material {
  id: string;
  organization_id: string;
  name: string;
  unit: string;
  coverage_per_unit_sqft: number | null;
  waste_factor_pct: number;
  cost_per_unit: number | null;
  active: boolean;
  description: string | null;
  purchase_url: string | null;
  quantity_on_hand: number | null;
  reorder_threshold: number | null;
  on_order: boolean;
  storage_location: string | null;
  shop_location: string | null;
  stock_method: "in_stock" | "order_as_needed";
  is_delivered: boolean;
  image_path: string | null;
  can_store: boolean;
  storage_alternative: string | null;
  storage_requirements: string | null;
  storage_cost: number | null;
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

export interface OverheadExpense {
  id: string;
  organization_id: string;
  name: string;
  amount: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServicePricing {
  organization_id: string;
  service_type_id: string;
  name: string;
  status: "active" | "pending" | "denied";
  requested_by: string | null;
  requested_note: string | null;
  cogs: number | null;
  cost: number | null;
  cost_unit: string;
  estimated_hours: number | null;
  minutes_per_sqft: number | null;
  how_to: string | null;
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
  house_outline: { x: number; y: number }[];
  zones: unknown[];
  created_at: string;
  updated_at: string;
}
