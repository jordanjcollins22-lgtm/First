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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
