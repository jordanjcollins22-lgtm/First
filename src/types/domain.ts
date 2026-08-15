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
  account_manager_id: string | null;
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
  /** Display name, kept in sync from first/last — what the rest of the app reads. */
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  roles: Role[];
  organization_id: string;
  pay_type: "hourly" | "commission" | "both";
  pay_rate_per_hour: number | null;
  commission_pct: number | null;
  affiliate_slug: string | null;
  /** Granted by an admin — gives them their own booking link. */
  is_affiliate: boolean;
  phone: string | null;
  /** Licence details only matter for people who drive for the business. */
  drives_for_company: boolean;
  license_number: string | null;
  license_state: string | null;
  license_class: string | null;
  license_expires: string | null;
  created_at: string;
  updated_at: string;
}

/** A named calendar an admin manages, with people assigned to it. */
export interface Calendar {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  description: string | null;
  /** Built in rather than added by the business — the Evaluations calendar
   * the schedule depends on. Editable and staffable, but not deletable. */
  is_system: boolean;
  /** What this calendar sends. Whether a person receives it is still their
   * own choice under Notifications — both have to be on. */
  reminders_enabled: boolean;
  reminder_hours_before: number;
  notify_on_booking: boolean;
  notify_on_change: boolean;
  created_at: string;
  updated_at: string;
}

/** A calendar plus who's on it, for the settings screen. */
export interface CalendarWithMembers extends Calendar {
  memberIds: string[];
}

/** A group the team messages in, not attached to any job. */
export interface TeamChannel {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AttachmentKind = "image" | "video" | "audio";

export interface TeamMessage {
  id: string;
  channel_id: string;
  organization_id: string;
  author_profile_id: string | null;
  author_name: string;
  /** Null when the message is only an attachment. */
  body: string | null;
  attachment_path: string | null;
  attachment_kind: AttachmentKind | null;
  attachment_name: string | null;
  /** Filled in after the fact for voice memos. Null means not transcribed —
   * either still running, or transcription isn't configured. */
  transcript: string | null;
  created_at: string;
}

export interface TeamChannelWithMembers extends TeamChannel {
  memberIds: string[];
  lastMessage: TeamMessage | null;
  messageCount: number;
}

/** What a person has opted into being texted about. Everyone manages their
 * own — nothing here is set for them by an admin. */
export interface NotificationPreferences {
  profile_id: string;
  organization_id: string;
  sms_enabled: boolean;
  appointment_reminders: boolean;
  client_messages: boolean;
  proposal_responses: boolean;
  team_messages: boolean;
  reminder_hours_before: number;
  created_at: string;
  updated_at: string;
}

export type NotificationKind = "appointment_reminders" | "client_messages" | "proposal_responses" | "team_messages";

/** How one person wants to hear about one group. "default" follows their
 * general Team group messages setting. */
export type ChannelNotifyChoice = "default" | "always" | "muted";

export interface ChannelNotificationSetting {
  channelId: string;
  channelName: string;
  choice: ChannelNotifyChoice;
}

export interface CustomRole {
  name: string;
  is_system: boolean;
}

export interface RolePermission {
  role_name: string;
  tab_key: string;
}

/** Tools are equipment used to do the work; gear is what the crew wears,
 * lays down, or consumes — PPE, tarps, plywood, water, electrolytes. Both
 * are stocked and reordered identically, so they share one table. */
export type ToolCategory = "tool" | "gear";

export interface Tool {
  id: string;
  organization_id: string;
  name: string;
  category: ToolCategory;
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
  /** What a purchase looks like — pack_size units for pack_cost dollars.
   * cost_per_unit is derived from these whenever both are set. */
  pack_size: number | null;
  pack_cost: number | null;
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

/** What a service's price multiplies by. "count" uses the Quantity the
 * evaluator enters on the zone (how many bushes), "flat" charges once. */
export type PricingBasis = "area" | "perimeter" | "count" | "flat";

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
  pricing_basis: PricingBasis;
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

export type ProposalStatus = "needs_approval" | "sent" | "accepted" | "declined";

/** One work area as it appeared on the proposal at the moment it was generated. */
export interface ProposalZoneSnapshot {
  zoneName: string;
  serviceLabel: string;
  scopeText: string;
  photoPaths: string[];
  /** Outline in the same fixed canvas coordinate space as site_image_transform. */
  points: { x: number; y: number }[];
  color: string;
}

/** How the reference photo sits under the drawn zones — same transform the
 * live canvas board uses (translate to x/y, rotate, then draw centered at
 * the image's own natural size x scale). */
export interface ProposalSiteImageTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  canvasWidth: number;
  canvasHeight: number;
}

export type MessageChannel = "internal" | "external";
export type MessageAuthorType = "team" | "client";

/** One message in a job's conversation — "internal" is team-only, "external"
 * is shared with the client on the proposal page too. */
export interface JobMessage {
  id: string;
  job_id: string;
  organization_id: string;
  channel: MessageChannel;
  author_type: MessageAuthorType;
  author_profile_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
}

export type DiscountKind = "percentage" | "amount";

/** A reusable discount an account manager can apply to a proposal — picked
 * from a list instead of typed by hand each time. */
export interface Discount {
  id: string;
  organization_id: string;
  name: string;
  kind: DiscountKind;
  value: number;
  created_at: string;
  updated_at: string;
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
  discount_id: string | null;
  discount_kind: DiscountKind | null;
  discount_value: number | null;
  discount_amount: number;
  discount_reason: string | null;
  scope_snapshot: ProposalZoneSnapshot[];
  site_image_path: string | null;
  site_image_transform: ProposalSiteImageTransform | null;
  generated_at: string;
  approved_at: string | null;
  responded_at: string | null;
  client_response_note: string | null;
  created_at: string;
  updated_at: string;
}

export type InvoiceStatus = "open" | "paid" | "void" | "uncollectible";

/** A real Stripe invoice, sent automatically the moment a client accepts a
 * proposal — Stripe hosts the payment page and PDF; this is our record of
 * it plus paid/void status kept in sync by the Stripe webhook. */
export interface Invoice {
  id: string;
  organization_id: string;
  job_id: string;
  proposal_id: string | null;
  amount: number;
  status: InvoiceStatus;
  stripe_customer_id: string | null;
  stripe_invoice_id: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}
