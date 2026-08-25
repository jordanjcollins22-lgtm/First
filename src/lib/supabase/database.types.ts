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
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string | null;
          crew_cost_per_hour: number | null;
          measurement_unit: string;
          measurement_basis: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["organizations"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Row"]>;
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          email: string | null;
          phone: string | null;
          notes: string | null;
          account_manager_id: string | null;
          contact_type: string;
          source: string | null;
          import_batch: string | null;
          external_id: string | null;
          do_not_contact: boolean;
          tags: string[] | null;
          import_address: string | null;
          pipeline: string | null;
          pipeline_stage: string | null;
          opportunity_value: number | null;
          geocode_attempted_at: string | null;
          geocode_error: string | null;
          in_target_market: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["customers"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["customers"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      properties: {
        Row: {
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
      target_markets: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          zips: string[];
          cities: string[];
          counties: string[];
          active: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["target_markets"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["target_markets"]["Row"]>;
        Relationships: [];
      };
      contact_merges: {
        Row: {
          id: string;
          organization_id: string;
          kept_id: string;
          kept_name: string;
          merged_snapshot: Record<string, unknown>;
          merged_name: string;
          moved_property_ids: string[];
          patched_fields: Record<string, unknown>;
          merged_by: string | null;
          merged_at: string;
          undone_at: string | null;
          undone_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["contact_merges"]["Row"]> & {
          organization_id: string;
          kept_id: string;
          kept_name: string;
          merged_snapshot: Record<string, unknown>;
          merged_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["contact_merges"]["Row"]>;
        Relationships: [];
      };
      org_counters: {
        Row: { organization_id: string; next_job_number: number };
        Insert: { organization_id: string; next_job_number?: number };
        Update: Partial<{ organization_id: string; next_job_number: number }>;
        Relationships: [];
      };
      jobs: {
        Row: {
          job_number: number | null;
          id: string;
          property_id: string;
          name: string;
          status: string;
          assigned_to: string | null;
          source_attractor_wave_id: string | null;
          evaluation_date: string | null;
          evaluation_end_date: string | null;
          evaluation_status: string;
          project_start_date: string | null;
          project_end_date: string | null;
          client_notes: string | null;
          budget_range: string | null;
          referred_by_profile_id: string | null;
          cancelled_at: string | null;
          cancellation_reason: string | null;
          completed_at: string | null;
          completed_by: string | null;
          completion_notes: string | null;
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
      job_requested_services: {
        Row: {
          job_id: string;
          organization_id: string;
          service_type_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_requested_services"]["Row"]> & {
          job_id: string;
          organization_id: string;
          service_type_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_requested_services"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_requested_services_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          first_name: string | null;
          last_name: string | null;
          organization_id: string;
          drives_for_company: boolean;
          license_number: string | null;
          license_state: string | null;
          license_class: string | null;
          license_expires: string | null;
          pay_type: string;
          pay_rate_per_hour: number | null;
          commission_pct: number | null;
          affiliate_slug: string | null;
          is_affiliate: boolean;
          phone: string | null;
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
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      calendars: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          color: string;
          description: string | null;
          is_system: boolean;
          reminders_enabled: boolean;
          reminder_hours_before: number;
          notify_on_booking: boolean;
          notify_on_change: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["calendars"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendars"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "calendars_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_members: {
        Row: {
          calendar_id: string;
          profile_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["calendar_members"]["Row"]> & {
          calendar_id: string;
          profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_members"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "calendar_members_calendar_id_fkey";
            columns: ["calendar_id"];
            referencedRelation: "calendars";
            referencedColumns: ["id"];
          },
        ];
      };
      team_channels: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["team_channels"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_channels"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "team_channels_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      team_channel_members: {
        Row: {
          channel_id: string;
          profile_id: string;
          notify_override: boolean | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["team_channel_members"]["Row"]> & {
          channel_id: string;
          profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_channel_members"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "team_channel_members_channel_id_fkey";
            columns: ["channel_id"];
            referencedRelation: "team_channels";
            referencedColumns: ["id"];
          },
        ];
      };
      team_messages: {
        Row: {
          id: string;
          channel_id: string;
          organization_id: string;
          author_profile_id: string | null;
          author_name: string;
          body: string | null;
          attachment_path: string | null;
          attachment_kind: string | null;
          attachment_name: string | null;
          transcript: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["team_messages"]["Row"]> & {
          channel_id: string;
          organization_id: string;
          author_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_messages"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "team_messages_channel_id_fkey";
            columns: ["channel_id"];
            referencedRelation: "team_channels";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          profile_id: string;
          organization_id: string;
          sms_enabled: boolean;
          appointment_reminders: boolean;
          client_messages: boolean;
          proposal_responses: boolean;
          team_messages: boolean;
          walkthrough_requests: boolean;
          reminder_hours_before: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["notification_preferences"]["Row"]> & {
          profile_id: string;
          organization_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["notification_preferences"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_log: {
        Row: {
          id: string;
          profile_id: string;
          kind: string;
          reference_id: string;
          sent_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["notification_log"]["Row"]> & {
          profile_id: string;
          kind: string;
          reference_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["notification_log"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "notification_log_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
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
      profile_roles: {
        Row: {
          profile_id: string;
          role_name: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profile_roles"]["Row"]> & {
          profile_id: string;
          role_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["profile_roles"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "profile_roles_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_roles_role_name_fkey";
            columns: ["role_name"];
            referencedRelation: "roles";
            referencedColumns: ["name"];
          },
        ];
      };
      role_permissions: {
        Row: {
          role_name: string;
          tab_key: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["role_permissions"]["Row"]> & {
          role_name: string;
          tab_key: string;
        };
        Update: Partial<Database["public"]["Tables"]["role_permissions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_name_fkey";
            columns: ["role_name"];
            referencedRelation: "roles";
            referencedColumns: ["name"];
          },
        ];
      };
      overhead_expenses: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          amount: number;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["overhead_expenses"]["Row"]> & {
          name: string;
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["overhead_expenses"]["Row"]>;
        Relationships: [];
      };
      tools: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          icon: string;
          cost: number | null;
          is_rental: boolean;
          category: string;
          active: boolean;
          kits: number[];
          image_path: string | null;
          quantity: number | null;
          storage_location: string | null;
          shop_location: string | null;
          stock_method: string;
          is_delivered: boolean;
          purchase_url: string | null;
          how_to_url: string | null;
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
          organization_id: string;
          name: string;
          unit: string;
          coverage_per_unit_sqft: number | null;
          pack_size: number | null;
          pack_cost: number | null;
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
          stock_method: string;
          is_delivered: boolean;
          image_path: string | null;
          can_store: boolean;
          storage_alternative: string | null;
          storage_requirements: string | null;
          storage_cost: number | null;
          type_options: string[];
          color_options: string[];
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
          organization_id: string;
          service_type_id: string;
          name: string;
          status: string;
          requested_by: string | null;
          requested_note: string | null;
          cogs: number | null;
          cost: number | null;
          cost_unit: string;
          pricing_basis: string;
          estimated_hours: number | null;
          minutes_per_sqft: number | null;
          crew_size: number;
          how_to: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["services"]["Row"]> & {
          organization_id: string;
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
          house_outline: Json;
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
          organization_id: string;
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
          organization_id: string;
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
          organization_id: string;
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
      journeys: {
        Row: {
          id: string;
          organization_id: string;
          role_key: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["journeys"]["Row"]> & {
          organization_id: string;
          role_key: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["journeys"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "journeys_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      journey_steps: {
        Row: {
          id: string;
          journey_id: string;
          step_key: string;
          order_index: number;
          label: string;
          step_type: string;
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
        };
        Insert: Partial<Database["public"]["Tables"]["journey_steps"]["Row"]> & {
          journey_id: string;
          step_key: string;
          label: string;
        };
        Update: Partial<Database["public"]["Tables"]["journey_steps"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "journey_steps_journey_id_fkey";
            columns: ["journey_id"];
            referencedRelation: "journeys";
            referencedColumns: ["id"];
          },
        ];
      };
      availability_weekly: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["availability_weekly"]["Row"]> & {
          organization_id: string;
          profile_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
        };
        Update: Partial<Database["public"]["Tables"]["availability_weekly"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "availability_weekly_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      availability_days_off: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          date: string;
          start_time: string | null;
          end_time: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["availability_days_off"]["Row"]> & {
          organization_id: string;
          profile_id: string;
          date: string;
        };
        Update: Partial<Database["public"]["Tables"]["availability_days_off"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "availability_days_off_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_proposals: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          token: string;
          status: string;
          total_cost: number | null;
          discount_id: string | null;
          discount_kind: string | null;
          discount_value: number | null;
          discount_amount: number;
          discount_reason: string | null;
          scope_snapshot: unknown;
          site_image_path: string | null;
          site_image_transform: unknown;
          generated_at: string;
          approved_at: string | null;
          responded_at: string | null;
          client_response_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_proposals"]["Row"]> & {
          job_id: string;
          organization_id: string;
          token: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_proposals"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_proposals_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      discounts: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          kind: string;
          value: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["discounts"]["Row"]> & {
          organization_id: string;
          name: string;
          kind: string;
          value: number;
        };
        Update: Partial<Database["public"]["Tables"]["discounts"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "discounts_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          proposal_id: string | null;
          amount: number;
          status: string;
          stripe_customer_id: string | null;
          stripe_invoice_id: string | null;
          hosted_invoice_url: string | null;
          invoice_pdf: string | null;
          sent_at: string | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["invoices"]["Row"]> & {
          organization_id: string;
          job_id: string;
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["invoices"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "invoices_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_prospects: {
        Row: {
          id: string;
          organization_id: string;
          source: string;
          source_batch: string | null;
          owner_name: string | null;
          address: string;
          address_key: string;
          city: string | null;
          state: string | null;
          zip: string | null;
          lat: number | null;
          lng: number | null;
          acreage: number | null;
          sqft: number | null;
          year_built: number | null;
          assessed_value: number | null;
          phone: string | null;
          email: string | null;
          status: string;
          do_not_contact: boolean;
          do_not_contact_reason: string | null;
          estimated_ticket: number | null;
          score: number | null;
          notes: string | null;
          converted_customer_id: string | null;
          in_target_market: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["lead_prospects"]["Row"]> & {
          organization_id: string;
          source: string;
          address: string;
          address_key: string;
        };
        Update: Partial<Database["public"]["Tables"]["lead_prospects"]["Row"]>;
        Relationships: [];
      };
      team_payments: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          amount: number;
          status: string;
          method: string | null;
          period_start: string | null;
          period_end: string | null;
          hours: number | null;
          paid_at: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["team_payments"]["Row"]> & {
          organization_id: string;
          profile_id: string;
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["team_payments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "team_payments_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_work_sessions: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          starts_on: string;
          ends_on: string;
          status: string;
          purpose: string | null;
          pause_reason: string | null;
          ticket_id: string | null;
          stop_order: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_work_sessions"]["Row"]> & {
          job_id: string;
          organization_id: string;
          starts_on: string;
          ends_on: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_work_sessions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_work_sessions_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_crew: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          profile_id: string;
          is_lead: boolean;
          added_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_crew"]["Row"]> & {
          job_id: string;
          organization_id: string;
          profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_crew"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_crew_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_crew_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_observers: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          name: string;
          email: string | null;
          phone: string | null;
          relationship: string;
          token: string;
          revoked_at: string | null;
          last_viewed_at: string | null;
          added_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_observers"]["Row"]> & {
          organization_id: string;
          job_id: string;
          name: string;
          token: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_observers"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_observers_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      outreach_channels: {
        Row: {
          id: string;
          organization_id: string;
          key: string;
          name: string;
          temperature: string;
          cost_type: string;
          summary: string | null;
          playbook: string | null;
          daily_target: number | null;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["outreach_channels"]["Row"]> & {
          organization_id: string;
          key: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["outreach_channels"]["Row"]>;
        Relationships: [];
      };
      outreach_touches: {
        Row: {
          id: string;
          organization_id: string;
          channel_id: string;
          profile_id: string | null;
          prospect_id: string | null;
          customer_id: string | null;
          outcome: string;
          note: string | null;
          at: string;
          day: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["outreach_touches"]["Row"]> & {
          organization_id: string;
          channel_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["outreach_touches"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "outreach_touches_channel_id_fkey";
            columns: ["channel_id"];
            referencedRelation: "outreach_channels";
            referencedColumns: ["id"];
          },
        ];
      };
      crew_day_events: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          day: string;
          kind: string;
          job_id: string | null;
          at: string;
          lat: number | null;
          lng: number | null;
          note: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["crew_day_events"]["Row"]> & {
          organization_id: string;
          profile_id: string;
          day: string;
          kind: string;
        };
        Update: Partial<Database["public"]["Tables"]["crew_day_events"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "crew_day_events_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_walkthroughs: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          requested_by: string | null;
          requested_at: string;
          requested_note: string | null;
          status: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_walkthroughs"]["Row"]> & {
          job_id: string;
          organization_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_walkthroughs"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_walkthroughs_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_tickets: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          title: string;
          detail: string | null;
          cause: string | null;
          severity: string;
          status: string;
          billable: boolean;
          resolution: string | null;
          resolved_at: string | null;
          opened_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_tickets"]["Row"]> & {
          job_id: string;
          organization_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_tickets"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_tickets_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_photos: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          path: string;
          kind: string;
          zone_id: string | null;
          zone_name: string | null;
          caption: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_photos"]["Row"]> & {
          job_id: string;
          organization_id: string;
          path: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_photos"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_photos_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_entries: {
        Row: {
          id: string;
          organization_id: string;
          direction: string;
          category: string;
          amount: number;
          occurred_on: string;
          method: string | null;
          party: string | null;
          job_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["ledger_entries"]["Row"]> & {
          organization_id: string;
          direction: string;
          category: string;
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["ledger_entries"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "ledger_entries_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_messages: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          channel: string;
          author_type: string;
          author_profile_id: string | null;
          author_name: string;
          body: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_messages"]["Row"]> & {
          job_id: string;
          organization_id: string;
          channel: string;
          author_type: string;
          author_name: string;
          body: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_messages"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_messages_job_id_fkey";
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
