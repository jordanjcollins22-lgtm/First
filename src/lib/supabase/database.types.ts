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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
