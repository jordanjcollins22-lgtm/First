/**
 * Hand-written Supabase Database type (no CLI codegen access in this
 * environment). Keep column names in sync with supabase/migrations/0001_init.sql.
 * jsonb columns are typed `any` here and narrowed to domain types
 * (src/types/domain.ts) at the call site.
 *
 * Every table needs `Relationships` and the schema needs `Views`/
 * `Functions` (even if empty) — supabase-js's GenericSchema constraint
 * requires them, and without them the generic type resolution silently
 * collapses every query result to `never`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface Database {
  public: {
    Tables: {
      customers: {
        Row: {
          id: string;
          name: string;
          email: string | null;
          phone: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["customers"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["customers"]["Row"]>;
        Relationships: [];
      };
      properties: {
        Row: {
          id: string;
          customer_id: string;
          address: string;
          lat: number;
          lng: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["properties"]["Row"]> & {
          customer_id: string;
          address: string;
          lat: number;
          lng: number;
        };
        Update: Partial<Database["public"]["Tables"]["properties"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "properties_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["jobs"]["Row"]> & {
          property_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["jobs"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "jobs_property_id_fkey";
            columns: ["property_id"];
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      zones: {
        Row: {
          id: string;
          job_id: string;
          name: string;
          auto_named: boolean;
          sequence_order: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["zones"]["Row"]> & {
          job_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["zones"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "zones_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      work_areas: {
        Row: {
          id: string;
          job_id: string;
          zone_id: string | null;
          service_template_id: string;
          geometry: Json;
          cleaned_geometry: Json | null;
          calculated_measurements: Json | null;
          notes: string | null;
          sequence_order: number | null;
          status: string;
          geometry_locked_at: string | null;
          geometry_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["work_areas"]["Row"]> & {
          job_id: string;
          service_template_id: string;
          geometry: Json;
        };
        Update: Partial<Database["public"]["Tables"]["work_areas"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "work_areas_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_areas_zone_id_fkey";
            columns: ["zone_id"];
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_areas_service_template_id_fkey";
            columns: ["service_template_id"];
            referencedRelation: "service_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      work_area_geometry_versions: {
        Row: {
          id: string;
          work_area_id: string;
          version: number;
          geometry: Json;
          cleaned_geometry: Json | null;
          calculated_measurements: Json | null;
          locked_at: string;
          reason: string | null;
        };
        Insert: Partial<
          Database["public"]["Tables"]["work_area_geometry_versions"]["Row"]
        > & {
          work_area_id: string;
          version: number;
          geometry: Json;
        };
        Update: Partial<
          Database["public"]["Tables"]["work_area_geometry_versions"]["Row"]
        >;
        Relationships: [
          {
            foreignKeyName: "work_area_geometry_versions_work_area_id_fkey";
            columns: ["work_area_id"];
            referencedRelation: "work_areas";
            referencedColumns: ["id"];
          },
        ];
      };
      service_templates: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          allowed_geometry_types: string[];
          required_measurement_type: string;
          estimator_questions: Json;
          required_photo_count: number;
          crew_steps: string[];
          tools_required: string[];
          equipment_required: string[];
          materials_formula: Json;
          quality_control_requirements: string[];
          before_photo_requirements: string[];
          after_photo_requirements: string[];
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["service_templates"]["Row"]
        > & {
          name: string;
          required_measurement_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["service_templates"]["Row"]>;
        Relationships: [];
      };
      photos: {
        Row: {
          id: string;
          work_area_id: string;
          storage_path: string;
          stage: string;
          caption: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["photos"]["Row"]> & {
          work_area_id: string;
          storage_path: string;
        };
        Update: Partial<Database["public"]["Tables"]["photos"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "photos_work_area_id_fkey";
            columns: ["work_area_id"];
            referencedRelation: "work_areas";
            referencedColumns: ["id"];
          },
        ];
      };

      // ---- govcon (supabase/migrations/0003_govcon.sql) ----
      govcon_settings: GovconTable<GovconSettingsRow, never>;
      govcon_opportunities: GovconTable<GovconOpportunityRow, "opportunity_key" | "notice_id" | "source" | "notice_type" | "title">;
      govcon_subcontractors: GovconTable<GovconSubcontractorRow, "dedupe_key" | "name" | "source">;
      govcon_rfqs: GovconTable<GovconRfqRow, "opportunity_id" | "subcontractor_id" | "token">;
      govcon_quotes: GovconTable<GovconQuoteRow, "rfq_id" | "opportunity_id" | "subcontractor_id" | "amount">;
      govcon_bids: GovconTable<GovconBidRow, "opportunity_id" | "sub_cost" | "price" | "markup">;
      govcon_events: GovconTable<GovconEventRow, "kind" | "message">;
      govcon_runs: GovconTable<GovconRunRow, "stage">;
      govcon_contracts: GovconTable<GovconContractRow, "opportunity_id">;
      govcon_sam_entities: GovconTable<GovconSamEntityRow, "uei" | "legal_name">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ---------------------------------------------------------------------------
// govcon tables (type aliases, not interfaces: supabase-js needs rows to be
// assignable to Record<string, unknown>). Relationships are left empty: govcon queries join in app
// code, and an empty tuple keeps supabase-js's generics happy.
// ---------------------------------------------------------------------------
type GovconTable<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export type GovconSettingsRow = {
  id: number;
  profile: Json;
  company: Json;
  state: Json;
  updated_at: string;
};

export type GovconOpportunityRow = {
  id: string;
  opportunity_key: string;
  notice_id: string;
  source: string;
  notice_type: string;
  title: string;
  solicitation_number: string | null;
  agency: string | null;
  office: string | null;
  naics_code: string | null;
  psc_code: string | null;
  set_aside: string;
  set_aside_label: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  pop_city: string | null;
  pop_state: string | null;
  pop_zip: string | null;
  pop_country: string | null;
  points_of_contact: Json;
  description: string | null;
  url: string | null;
  estimated_value: number | null;
  trade: string | null;
  score: number;
  recommendation: "bid" | "maybe" | "no_bid";
  score_detail: Json;
  subcontracting: Json;
  status: "new" | "needs_docs" | "sourcing" | "awaiting_quotes" | "ready" | "submitted" | "won" | "lost" | "no_bid" | "expired";
  status_reason: string | null;
  analysis: Json | null;
  attachments: Json;
  comparables: Json;
  price_anchor: Json | null;
  analyzed_at: string | null;
  last_error: string | null;
  expected_annual_value: number | null;
  priority: number;
  estimated_at: string | null;
  uploaded_docs: Json;
  created_at: string;
  updated_at: string;
};

export type GovconSubcontractorRow = {
  id: string;
  dedupe_key: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rating: number | null;
  review_count: number | null;
  place_id: string | null;
  uei: string | null;
  trades: string[];
  source: string;
  is_small_business: boolean | null;
  past_federal_amount: number | null;
  do_not_contact: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type GovconRfqRow = {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  token: string;
  channel: "email" | "call";
  status: "queued" | "sent" | "viewed" | "quoted" | "declined" | "no_response" | "failed" | "called";
  quote_due_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  followups: number;
  last_followup_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type GovconQuoteRow = {
  id: string;
  rfq_id: string;
  opportunity_id: string;
  subcontractor_id: string;
  amount: number;
  notes: string | null;
  lead_time: string | null;
  accepts_net30: boolean | null;
  down_payment_pct: number | null;
  uses_own_employees: boolean | null;
  is_small_business: boolean | null;
  uei: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  references_text: string | null;
  file_path: string | null;
  compliance: Json | null;
  created_at: string;
};

export type GovconBidRow = {
  id: string;
  opportunity_id: string;
  quote_id: string | null;
  sub_cost: number;
  price: number;
  markup: number;
  pricing: Json;
  proposal: Json | null;
  compliance_check: Json;
  status: "draft" | "approved" | "submitted" | "won" | "lost";
  submitted_at: string | null;
  award_amount: number | null;
  awardee: string | null;
  created_at: string;
  updated_at: string;
};

export type GovconEventRow = {
  id: string;
  opportunity_id: string | null;
  kind: string;
  message: string;
  data: Json | null;
  created_at: string;
};

export type GovconRunRow = {
  id: string;
  stage: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  stats: Json;
  error: string | null;
};

export type GovconContractRow = {
  id: string;
  opportunity_id: string;
  bid_id: string | null;
  subcontractor_id: string | null;
  contract_number: string | null;
  total_value: number;
  annual_value: number;
  sub_annual_cost: number;
  start_date: string | null;
  end_date: string | null;
  status: "active" | "complete" | "terminated";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type GovconSamEntityRow = {
  uei: string;
  cage: string | null;
  legal_name: string;
  dba_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip5: string | null;
  website: string | null;
  naics: string[];
  small_naics: string[];
  business_types: string[];
  poc_name: string | null;
  registration_expires: string | null;
  extract_date: string | null;
  updated_at: string;
};
