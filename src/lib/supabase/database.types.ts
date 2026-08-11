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
          assigned_to: string | null;
          source_attractor_wave_id: string | null;
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
          {
            foreignKeyName: "jobs_assigned_to_fkey";
            columns: ["assigned_to"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "profiles_role_fkey";
            columns: ["role"];
            referencedRelation: "roles";
            referencedColumns: ["name"];
          },
        ];
      };
      roles: {
        Row: {
          name: string;
          is_system: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["roles"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["roles"]["Row"]>;
        Relationships: [];
      };
      tools: {
        Row: {
          id: string;
          name: string;
          icon: string;
          cost: number | null;
          is_rental: boolean;
          active: boolean;
          kits: number[];
          image_path: string | null;
          quantity: number | null;
          storage_location: string | null;
          purchase_url: string | null;
          reorder_threshold: number | null;
          on_order: boolean;
          not_owned_reason: string | null;
          cost_to_own: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tools"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["tools"]["Row"]>;
        Relationships: [];
      };
      materials: {
        Row: {
          id: string;
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
          image_path: string | null;
          can_store: boolean;
          storage_alternative: string | null;
          storage_requirements: string | null;
          storage_cost: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["materials"]["Row"]> & {
          name: string;
          unit: string;
        };
        Update: Partial<Database["public"]["Tables"]["materials"]["Row"]>;
        Relationships: [];
      };
      service_tools: {
        Row: {
          service_type_id: string;
          tool_id: string;
        };
        Insert: Database["public"]["Tables"]["service_tools"]["Row"];
        Update: Partial<Database["public"]["Tables"]["service_tools"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "service_tools_tool_id_fkey";
            columns: ["tool_id"];
            referencedRelation: "tools";
            referencedColumns: ["id"];
          },
        ];
      };
      service_materials: {
        Row: {
          id: string;
          service_type_id: string;
          material_id: string;
          match_field: string | null;
          match_value: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["service_materials"]["Row"]> & {
          service_type_id: string;
          material_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["service_materials"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "service_materials_material_id_fkey";
            columns: ["material_id"];
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          service_type_id: string;
          cost: number | null;
          cost_unit: string;
          estimated_hours: number | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["services"]["Row"]> & {
          service_type_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["services"]["Row"]>;
        Relationships: [];
      };
      canvas_designs: {
        Row: {
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
          property_line: Json;
          zones: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["canvas_designs"]["Row"]> & {
          job_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["canvas_designs"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "canvas_designs_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      custom_field_options: {
        Row: {
          id: string;
          service_type_id: string;
          field_key: string;
          value: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["custom_field_options"]["Row"]> & {
          service_type_id: string;
          field_key: string;
          value: string;
        };
        Update: Partial<Database["public"]["Tables"]["custom_field_options"]["Row"]>;
        Relationships: [];
      };
      attractor_types: {
        Row: {
          id: string;
          label: string;
          is_system: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["attractor_types"]["Row"]> & {
          id: string;
          label: string;
        };
        Update: Partial<Database["public"]["Tables"]["attractor_types"]["Row"]>;
        Relationships: [];
      };
      attractor_variants: {
        Row: {
          id: string;
          type_id: string;
          name: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["attractor_variants"]["Row"]> & {
          type_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["attractor_variants"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "attractor_variants_type_id_fkey";
            columns: ["type_id"];
            referencedRelation: "attractor_types";
            referencedColumns: ["id"];
          },
        ];
      };
      attractor_waves: {
        Row: {
          id: string;
          type_id: string;
          variant_id: string | null;
          name: string;
          geometry_type: string;
          geometry: Json;
          date_planned: string | null;
          date_completed: string | null;
          quantity_deployed: number | null;
          status: string;
          notes: string | null;
          leads_generated: number | null;
          projects_generated: number | null;
          revenue_generated: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["attractor_waves"]["Row"]> & {
          type_id: string;
          name: string;
          geometry_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["attractor_waves"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "attractor_waves_type_id_fkey";
            columns: ["type_id"];
            referencedRelation: "attractor_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attractor_waves_variant_id_fkey";
            columns: ["variant_id"];
            referencedRelation: "attractor_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      business_locations: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          lat: number;
          lng: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["business_locations"]["Row"]> & {
          name: string;
          lat: number;
          lng: number;
        };
        Update: Partial<Database["public"]["Tables"]["business_locations"]["Row"]>;
        Relationships: [];
      };
      location_areas: {
        Row: {
          id: string;
          location_id: string;
          name: string;
          geometry_type: string;
          geometry: Json;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["location_areas"]["Row"]> & {
          location_id: string;
          name: string;
          geometry_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["location_areas"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "location_areas_location_id_fkey";
            columns: ["location_id"];
            referencedRelation: "business_locations";
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
