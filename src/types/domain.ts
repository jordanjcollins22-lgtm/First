/**
 * Core domain types. Mirrors the Supabase/Postgres schema in
 * supabase/migrations. Keep in sync manually (no codegen for MVP).
 */

/** What a per-unit price multiplies by on a zone. */
export type MeasurementBasis = "area" | "perimeter" | "flat";

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  crew_cost_per_hour: number | null;
  measurement_unit: string;
  measurement_basis: MeasurementBasis;
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
  client_notes: string | null;
  budget_range: string | null;
  referred_by_profile_id: string | null;
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
  pay_type: "hourly" | "commission" | "both";
  pay_rate_per_hour: number | null;
  commission_pct: number | null;
  affiliate_slug: string | null;
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
  /** What this material comes in — the evaluator is only asked when these exist. */
  type_options: string[];
  color_options: string[];
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
  crew_size: number;
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

// ---------------------------------------------------------------------------
// Journey Dashboard — admin-only map of how each role (or the client) moves
// through the system. Steps are data so new roles/branches can be added
// without touching code; see supabase/migrations/0047_journey_dashboard.sql.
// ---------------------------------------------------------------------------

export type JourneyStepType = "human" | "automated" | "human_approval" | "customer_action" | "system_action";

export interface Journey {
  id: string;
  organization_id: string;
  role_key: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface JourneyStep {
  id: string;
  journey_id: string;
  step_key: string;
  order_index: number;
  label: string;
  step_type: JourneyStepType;
  role_label: string | null;
  inputs: string[];
  outputs: string[];
  automations: string[];
  next_steps: string[];
  clicks: number;
  manual_inputs: number;
  customer_comms: number;
  internal_comms: number;
  texts: number;
  emails: number;
  calls: number;
  est_minutes: number | null;
  is_built: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A day of the week (0 = Sunday .. 6 = Saturday) someone works, and the hours
 * they're available that day. No row for a day = not available that day. */
export interface WeeklyAvailability {
  id: string;
  organization_id: string;
  profile_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

/** A specific date someone is off (vacation, sick, etc). start_time/end_time both
 * null means the whole day; both set means only that window is blocked. */
export interface DayOff {
  id: string;
  organization_id: string;
  profile_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
}

export type ProposalStatus = "pending" | "accepted" | "declined";

/** One work area as it appeared on the proposal at the moment it was generated. */
export interface ProposalZoneSnapshot {
  zoneName: string;
  serviceLabel: string;
  scopeText: string;
  photoPaths: string[];
}

/** A client-facing proposal generated from a job's site map — price and scope
 * are frozen at generate time (see the migration for why). */
export interface JobProposal {
  id: string;
  job_id: string;
  organization_id: string;
  token: string;
  status: ProposalStatus;
  total_cost: number | null;
  scope_snapshot: ProposalZoneSnapshot[];
  site_image_path: string | null;
  generated_at: string;
  responded_at: string | null;
  client_response_note: string | null;
  created_at: string;
  updated_at: string;
}
