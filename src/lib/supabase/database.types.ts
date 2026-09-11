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
export type Json = any;

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          client_reminders_enabled: boolean;
          reminder_time_zone: string;
          reminder_quiet_start: number;
          reminder_quiet_end: number;
          name: string;
          slug: string | null;
          crew_cost_per_hour: number | null;
          price_multiplier: number;
          overhead_percent: number;
          /** Days a month the crew is on a paying job, not working days. */
          billable_days_per_month: number;
          crew_hours_per_day: number;
          crew_size: number;
          /** 'percent' or 'per_diem': how a quote charges overhead. */
          overhead_basis: string;
          /** Whether finished jobs get a tip link at all. */
          tips_enabled: boolean;
          /** What the tip page says about where the money goes. */
          tips_note: string | null;
          measurement_unit: string;
          measurement_basis: string;
          /** The scheduling engine is off until a business asks for it. */
          schedule_engine_enabled: boolean;
          created_at: string;
          updated_at: string;
          /** USPS EDDM Retail postage per piece, in dollars. A setting because USPS revises it. */
          eddm_postage_per_piece: number | null;
          /** What a piece costs to print in-house, in dollars. */
          eddm_print_cost_per_piece: number;
          marketing_since: string;
          roads_updated_at: string | null;
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
          auth_user_id: string | null;
          unsubscribe_token: string | null;
          stripe_customer_id: string | null;
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
      knowledge_nodes: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          description: string | null;
          node_type: string;
          status: string;
          is_issue: boolean;
          image_path: string | null;
          importance: number | null;
          estimated_cost: number | null;
          unit: string;
          potential_value: number | null;
          notes: string | null;
          position_x: number | null;
          position_y: number | null;
          cost_basis: string | null;
          output_per_unit: number | null;
          output_unit: string | null;
          run_size: number | null;
          run_unit: string | null;
          fixed_cost: number | null;
          duration_hours: number | null;
          hourly_rate: number | null;
          purchase_url: string | null;
          app_route: string | null;
          material_id: string | null;
          tool_id: string | null;
          scheduled_for: string | null;
          recurrence: string;
          recurrence_interval: number;
          last_done_at: string | null;
          times_done: number;
          metadata: Record<string, unknown>;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["knowledge_nodes"]["Row"]> & {
          organization_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_nodes"]["Row"]>;
        Relationships: [];
      };
      knowledge_relationships: {
        Row: {
          id: string;
          organization_id: string;
          source_node_id: string;
          target_node_id: string;
          relationship_type: string;
          strength: number;
          quantity: number | null;
          step_order: number | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["knowledge_relationships"]["Row"]> & {
          organization_id: string;
          source_node_id: string;
          target_node_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_relationships"]["Row"]>;
        Relationships: [];
      };
      social_posts: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          before_photo_id: string | null;
          after_photo_id: string | null;
          zone_id: string | null;
          zone_name: string | null;
          image_path: string | null;
          caption: string | null;
          status: string;
          scheduled_for: string | null;
          posted_at: string | null;
          channel: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["social_posts"]["Row"]> & {
          organization_id: string;
          job_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["social_posts"]["Row"]>;
        Relationships: [];
      };
      payment_plans: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string | null;
          proposal_id: string | null;
          invoice_id: string | null;
          customer_id: string;
          kind: string;
          total_cents: number;
          deposit_cents: number;
          instalments: number | null;
          interval: string | null;
          status: string;
          accepted_at: string | null;
          accepted_by: string | null;
          keeps_discount: boolean;
          schedules_after_final_payment: boolean;
          stripe_subscription_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payment_plans"]["Row"]> & {
          organization_id: string;
          customer_id: string;
          kind: string;
          total_cents: number;
        };
        Update: Partial<Database["public"]["Tables"]["payment_plans"]["Row"]>;
        Relationships: [];
      };
      payment_plan_instalments: {
        Row: {
          id: string;
          plan_id: string;
          number: number;
          amount_cents: number;
          due_on: string;
          is_deposit: boolean;
          status: string;
          stripe_invoice_id: string | null;
          stripe_payment_intent_id: string | null;
          hosted_url: string | null;
          paid_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payment_plan_instalments"]["Row"]> & {
          plan_id: string;
          number: number;
          amount_cents: number;
          due_on: string;
        };
        Update: Partial<Database["public"]["Tables"]["payment_plan_instalments"]["Row"]>;
        Relationships: [];
      };
      email_domains: {
        Row: {
          id: string;
          organization_id: string;
          hostname: string;
          stream: string;
          provider: string;
          provider_domain_id: string | null;
          status: string;
          dns_records: unknown;
          last_checked_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["email_domains"]["Row"]> & {
          organization_id: string;
          hostname: string;
          stream: string;
        };
        Update: Partial<Database["public"]["Tables"]["email_domains"]["Row"]>;
        Relationships: [];
      };
      email_senders: {
        Row: {
          id: string;
          organization_id: string;
          domain_id: string;
          address: string;
          display_name: string | null;
          reply_to: string | null;
          is_default: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["email_senders"]["Row"]> & {
          organization_id: string;
          domain_id: string;
          address: string;
        };
        Update: Partial<Database["public"]["Tables"]["email_senders"]["Row"]>;
        Relationships: [];
      };
      early_start_requests: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          session_id: string;
          requested_by: string;
          requested_for: string;
          note: string | null;
          status: string;
          decided_by: string | null;
          decided_at: string | null;
          decline_reason: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["early_start_requests"]["Row"]> & {
          organization_id: string;
          job_id: string;
          session_id: string;
          requested_by: string;
          requested_for: string;
        };
        Update: Partial<Database["public"]["Tables"]["early_start_requests"]["Row"]>;
        Relationships: [];
      };
      proposal_objections: {
        Row: {
          id: string;
          organization_id: string;
          proposal_id: string;
          objection_id: string;
          note: string | null;
          resolution: string | null;
          resolved: boolean | null;
          raised_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["proposal_objections"]["Row"]> & {
          organization_id: string;
          proposal_id: string;
          objection_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["proposal_objections"]["Row"]>;
        Relationships: [];
      };
      conversation_reads: {
        Row: {
          id: string;
          job_id: string;
          channel: string;
          organization_id: string;
          read_through: string;
          read_by: string | null;
          read_by_name: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["conversation_reads"]["Row"]> & {
          job_id: string;
          channel: string;
          organization_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversation_reads"]["Row"]>;
        Relationships: [];
      };
      evaluation_edits: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          edited_by: string | null;
          edited_by_name: string | null;
          changes: string[];
          requested_via: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["evaluation_edits"]["Row"]> & {
          job_id: string;
          organization_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["evaluation_edits"]["Row"]>;
        Relationships: [];
      };
      archived_proposals: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string;
          file_path: string;
          file_name: string;
          outcome: string;
          job_date: string | null;
          title: string | null;
          amount: number | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["archived_proposals"]["Row"]> & {
          organization_id: string;
          customer_id: string;
          file_path: string;
          file_name: string;
          outcome: string;
        };
        Update: Partial<Database["public"]["Tables"]["archived_proposals"]["Row"]>;
        Relationships: [];
      };
      client_invoices: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string;
          file_path: string | null;
          file_name: string | null;
          title: string | null;
          scope_html: string | null;
          subtotal: number | null;
          discount: number | null;
          source_status: string | null;
          source: string | null;
          external_id: string | null;
          invoice_number: string | null;
          amount: number | null;
          issued_on: string | null;
          due_on: string | null;
          paid_on: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["client_invoices"]["Row"]> & {
          organization_id: string;
          customer_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_invoices"]["Row"]>;
        Relationships: [];
      };
      proposal_edits: {
        Row: {
          id: string;
          proposal_id: string;
          organization_id: string;
          edited_by: string | null;
          edited_by_name: string | null;
          removed_zones: { zoneName: string; serviceLabel: string; priceCents: number | null }[];
          removed_lines: { zoneName: string; line: string }[];
          previous_total_cents: number | null;
          new_total_cents: number | null;
          note: string | null;
          requested_via: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["proposal_edits"]["Row"]> & {
          proposal_id: string;
          organization_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["proposal_edits"]["Row"]>;
        Relationships: [];
      };
      proposal_scope_requests: {
        Row: {
          id: string;
          organization_id: string;
          proposal_id: string;
          kept_zones: string[];
          dropped_zones: string[];
          previous_total_cents: number | null;
          new_total_cents: number | null;
          status: string;
          review_reason: string | null;
          requested_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["proposal_scope_requests"]["Row"]> & {
          organization_id: string;
          proposal_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["proposal_scope_requests"]["Row"]>;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          job_id: string | null;
          plan_id: string | null;
          instalment_id: string | null;
          amount_cents: number;
          currency: string;
          method: string;
          stripe_payment_intent_id: string | null;
          stripe_invoice_id: string | null;
          external_id: string | null;
          source: string | null;
          surcharge_cents: number | null;
          invoice_id: string | null;
          payer_name: string | null;
          payer_email: string | null;
          payer_phone: string | null;
          received_at: string;
          note: string | null;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payments"]["Row"]> & {
          organization_id: string;
          amount_cents: number;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Row"]>;
        Relationships: [];
      };
      job_photo_marks: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          photo_id: string;
          x: number;
          y: number;
          note: string;
          created_by: string | null;
          created_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["job_photo_marks"]["Row"]> & {
          organization_id: string;
          job_id: string;
          photo_id: string;
          x: number;
          y: number;
          note: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_photo_marks"]["Row"]>;
        Relationships: [];
      };
      time_entries: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          job_id: string | null;
          session_id: string | null;
          clocked_in_at: string;
          clocked_out_at: string | null;
          note: string | null;
          edited_by: string | null;
          edited_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["time_entries"]["Row"]> & {
          organization_id: string;
          profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["time_entries"]["Row"]>;
        Relationships: [];
      };
      job_photo_waivers: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          zone_id: string | null;
          stage: string;
          reason: string | null;
          waived_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_photo_waivers"]["Row"]> & {
          job_id: string;
          organization_id: string;
          stage: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_photo_waivers"]["Row"]>;
        Relationships: [];
      };
      rank_keywords: {
        Row: {
          id: string;
          organization_id: string;
          phrase: string;
          active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rank_keywords"]["Row"]> & {
          organization_id: string;
          phrase: string;
        };
        Update: Partial<Database["public"]["Tables"]["rank_keywords"]["Row"]>;
        Relationships: [];
      };
      rank_scans: {
        Row: {
          id: string;
          organization_id: string;
          keyword_id: string;
          centre_lat: number;
          centre_lng: number;
          grid_size: number;
          spacing_miles: number;
          source: string;
          note: string | null;
          ran_at: string;
          ran_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["rank_scans"]["Row"]> & {
          organization_id: string;
          keyword_id: string;
          centre_lat: number;
          centre_lng: number;
          grid_size: number;
          spacing_miles: number;
        };
        Update: Partial<Database["public"]["Tables"]["rank_scans"]["Row"]>;
        Relationships: [];
      };
      rank_points: {
        Row: {
          id: string;
          scan_id: string;
          grid_row: number;
          grid_col: number;
          lat: number;
          lng: number;
          rank: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["rank_points"]["Row"]> & {
          scan_id: string;
          grid_row: number;
          grid_col: number;
          lat: number;
          lng: number;
        };
        Update: Partial<Database["public"]["Tables"]["rank_points"]["Row"]>;
        Relationships: [];
      };
      door_hanger_slots: {
        Row: {
          id: string;
          organization_id: string;
          side: string;
          face: string;
          image_path: string | null;
          label: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["door_hanger_slots"]["Row"]> & {
          organization_id: string;
          side: string;
        };
        Update: Partial<Database["public"]["Tables"]["door_hanger_slots"]["Row"]>;
        Relationships: [];
      };
      flyer_runs: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          mails_on: string | null;
          flyer_count: number;
          spot_price_cents: number;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["flyer_runs"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["flyer_runs"]["Row"]>;
        Relationships: [];
      };
      flyer_bookings: {
        Row: {
          id: string;
          organization_id: string;
          run_id: string;
          business_name: string;
          contact_name: string | null;
          email: string | null;
          phone: string | null;
          image_path: string | null;
          artwork_kind: string;
          status: string;
          slot: number | null;
          amount_cents: number | null;
          checkout_session_id: string | null;
          paid_at: string | null;
          token: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["flyer_bookings"]["Row"]> & {
          organization_id: string;
          run_id: string;
          business_name: string;
          token: string;
        };
        Update: Partial<Database["public"]["Tables"]["flyer_bookings"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "flyer_bookings_run_id_fkey";
            columns: ["run_id"];
            referencedRelation: "flyer_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      flyer_ad_spots: {
        Row: {
          id: string;
          organization_id: string;
          slot: number;
          business_name: string | null;
          contact: string | null;
          image_path: string | null;
          price: number | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["flyer_ad_spots"]["Row"]> & {
          organization_id: string;
          slot: number;
        };
        Update: Partial<Database["public"]["Tables"]["flyer_ad_spots"]["Row"]>;
        Relationships: [];
      };
      /** The weed guide's plants: one list, printed two ways. */
      weeds: {
        Row: {
          id: string;
          organization_id: string;
          slug: string;
          common_name: string;
          scientific_name: string;
          weed_group: string;
          on_client_sheet: boolean;
          /** Six characters of the stock-label alphabet, printed under the photo. */
          code: string;
          /** The one photo that goes on paper. */
          print_photo_id: string | null;
          /** What to do before treating it; shared with the prep checklist. */
          prep: string | null;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["weeds"]["Row"]> & {
          organization_id: string;
          slug: string;
          common_name: string;
          scientific_name: string;
          weed_group: string;
          code: string;
        };
        Update: Partial<Database["public"]["Tables"]["weeds"]["Row"]>;
        Relationships: [];
      };
      weed_photos: {
        Row: {
          id: string;
          organization_id: string;
          weed_id: string;
          path: string;
          caption: string | null;
          credit: string | null;
          position: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["weed_photos"]["Row"]> & {
          organization_id: string;
          weed_id: string;
          path: string;
        };
        Update: Partial<Database["public"]["Tables"]["weed_photos"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "weed_photos_weed_id_fkey";
            columns: ["weed_id"];
            referencedRelation: "weeds";
            referencedColumns: ["id"];
          },
        ];
      };
      hanger_routes: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          seed_job_id: string | null;
          status: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["hanger_routes"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["hanger_routes"]["Row"]>;
        Relationships: [];
      };
      hanger_zones: {
        Row: {
          id: string;
          organization_id: string;
          route_id: string;
          name: string;
          geometry_type: string;
          geometry: Json;
          position: number;
          /** The outline not to leave. */
          boundary: Json | null;
          /** The streets, in the order to walk them. */
          walk_path: Json | null;
          walk_line?: Json | null;
          walked_at?: string | null;
          /** Gaps in the round: places no road joins, driven rather than walked. */
          walk_breaks?: number | null;
          /** How far those gaps are, together, in metres. */
          walk_jump_m?: number | null;
          /** A split part's own wave; the route's wave otherwise. */
          wave_id?: string | null;
          approval?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_mode?: string | null;
          approved_houses?: number | null;
          approval_note?: string | null;
          start_point: Json | null;
          /** Where the van goes. Rarely the first door. */
          park_point: Json | null;
          end_point: Json | null;
          start_address: string | null;
          eddm_route_id: string | null;
          zip: string | null;
          /** foot | scooter | vehicle, from the path length per door. */
          mode: string | null;
          house_count: number;
          path_km: number | null;
          est_minutes: number | null;
          median_gap_m: number | null;
          /** The whole outline as GeoJSON, which may be several pieces. */
          boundary_geojson: Json | null;
          built_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["hanger_zones"]["Row"]> & {
          organization_id: string;
          route_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["hanger_zones"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "hanger_zones_route_id_fkey";
            columns: ["route_id"];
            referencedRelation: "hanger_routes";
            referencedColumns: ["id"];
          },
        ];
      };
      houses: {
        Row: {
          id: string;
          organization_id: string;
          address: string;
          lat: number;
          lng: number;
          property_id: string | null;
          /** The county's own key, stabler than an address. */
          parcel_id: string | null;
          county: string | null;
          /** Public record, and supplemental property data rather than a contact. */
          owner_name: string | null;
          lot_size_sqft: number | null;
          /** The parcel outline, for drawing property lines under the marker. */
          boundary: Json | null;
          source: string | null;
          source_updated_at: string | null;
          /** The only join available between a parcel and a customer we had. */
          normalized_address: string | null;
          /** Which normalizer produced normalized_address, so keys can be regenerated. */
          address_normalizer_version: number;
          /** house | street | unusable. A street is not one address. */
          kind: string;
          needs_review: boolean;
          review_reason: string | null;
          /** When a person settled a held address, and who. */
          reviewed_at: string | null;
          reviewed_by: string | null;
          /** The county's own address text. `address` keeps the raw original. */
          gis_address: string | null;
          gis_matched_at: string | null;
          /** The USPS route whose street runs past this house, when one does. */
          eddm_route_id: string | null;
          eddm_route_distance_m: number | null;
          /** No route's streets come within reach: a missed door, or a new development. */
          eddm_unserved: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["houses"]["Row"]> & {
          organization_id: string;
          address: string;
          lat: number;
          lng: number;
        };
        Update: Partial<Database["public"]["Tables"]["houses"]["Row"]>;
        Relationships: [];
      };
      zone_houses: {
        Row: {
          zone_id: string;
          house_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["zone_houses"]["Row"]> & {
          zone_id: string;
          house_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["zone_houses"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "zone_houses_zone_id_fkey";
            columns: ["zone_id"];
            referencedRelation: "hanger_zones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "zone_houses_house_id_fkey";
            columns: ["house_id"];
            referencedRelation: "houses";
            referencedColumns: ["id"];
          },
        ];
      };
      door_hanger_events: {
        Row: {
          id: string;
          organization_id: string;
          house_id: string;
          zone_id: string | null;
          design_number: number;
          hung_at: string;
          hung_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["door_hanger_events"]["Row"]> & {
          organization_id: string;
          house_id: string;
          design_number: number;
        };
        Update: Partial<Database["public"]["Tables"]["door_hanger_events"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "door_hanger_events_house_id_fkey";
            columns: ["house_id"];
            referencedRelation: "houses";
            referencedColumns: ["id"];
          },
        ];
      };
      house_contacts: {
        Row: {
          house_id: string;
          customer_id: string;
          role: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["house_contacts"]["Row"]> & {
          house_id: string;
          customer_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["house_contacts"]["Row"]>;
        Relationships: [];
      };
      property_events: {
        Row: {
          id: string;
          organization_id: string;
          house_id: string;
          /** Ranked in src/lib/house-relationship.ts, which owns the order. */
          kind: string;
          occurred_at: string;
          job_id: string | null;
          customer_id: string | null;
          amount_cents: number | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["property_events"]["Row"]> & {
          organization_id: string;
          house_id: string;
          kind: string;
        };
        Update: Partial<Database["public"]["Tables"]["property_events"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "property_events_house_id_fkey";
            columns: ["house_id"];
            referencedRelation: "houses";
            referencedColumns: ["id"];
          },
        ];
      };
      gis_import_jobs: {
        Row: {
          id: string;
          organization_id: string;
          /** connection_test | zip | county */
          kind: string;
          /** queued | running | paused | done | failed */
          status: string;
          scope: Json;
          service_url: string;
          layer_url: string | null;
          layer_name: string | null;
          max_record_count: number | null;
          /** Every field the layer reported, as reported. */
          discovered_fields: Json | null;
          field_mapping: Json | null;
          layers_found: Json | null;
          total_expected: number | null;
          fetched: number;
          processed: number;
          matched: number;
          created: number;
          skipped: number;
          review: number;
          duplicates_prevented: number;
          errors: number;
          /** { offset }. Resuming starts here. */
          checkpoint: Json;
          steps: number;
          lease_until: string | null;
          before_totals: Json | null;
          after_totals: Json | null;
          /** The exact requests and answers, newest last. */
          diagnostics: Json;
          last_error: string | null;
          /** Authorises one more step of this job, and nothing else. */
          tick_token: string | null;
          started_by: string | null;
          started_at: string;
          finished_at: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["gis_import_jobs"]["Row"]> & {
          organization_id: string;
          kind: string;
          service_url: string;
        };
        Update: Partial<Database["public"]["Tables"]["gis_import_jobs"]["Row"]>;
        Relationships: [];
      };
      zone_reviews: {
        Row: {
          id: string;
          organization_id: string;
          zone_id: string | null;
          zone_name: string | null;
          decision: string;
          reason: string | null;
          note: string | null;
          mode: string | null;
          new_mode: string | null;
          houses: number | null;
          gap_m: number | null;
          path_km: number | null;
          est_minutes: number | null;
          reviewer: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["zone_reviews"]["Row"]> & {
          organization_id: string;
          decision: string;
        };
        Update: Partial<Database["public"]["Tables"]["zone_reviews"]["Row"]>;
        Relationships: [];
      };
      marketing_play_reviews: {
        Row: {
          id: string;
          organization_id: string;
          play_id: string | null;
          kind: string;
          reason: string | null;
          decision: string;
          quantity_before: number | null;
          quantity_after: number | null;
          removed_count: number;
          kept_max_m: number | null;
          removed_min_m: number | null;
          note: string | null;
          reviewer: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["marketing_play_reviews"]["Row"]> & {
          organization_id: string;
          kind: string;
          decision: string;
        };
        Update: Partial<Database["public"]["Tables"]["marketing_play_reviews"]["Row"]>;
        Relationships: [];
      };
      marketing_defaults: {
        Row: {
          organization_id: string;
          kind: string;
          quantity: number | null;
          max_distance_m: number | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["marketing_defaults"]["Row"]> & {
          organization_id: string;
          kind: string;
        };
        Update: Partial<Database["public"]["Tables"]["marketing_defaults"]["Row"]>;
        Relationships: [];
      };
      road_segments: {
        Row: {
          id: number;
          organization_id: string;
          tile: string;
          osm_id: number | null;
          highway: string | null;
          name: string | null;
          seg: unknown;
          bbox: unknown;
        };
        Insert: Partial<Database["public"]["Tables"]["road_segments"]["Row"]> & {
          organization_id: string;
          tile: string;
        };
        Update: Partial<Database["public"]["Tables"]["road_segments"]["Row"]>;
        Relationships: [];
      };
      bank_links: {
        Row: {
          id: string;
          organization_id: string;
          item_id: string;
          access_token: string;
          institution_id: string | null;
          institution_name: string | null;
          cursor: string | null;
          status: string;
          last_error: string | null;
          last_synced_at: string | null;
          linked_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["bank_links"]["Row"]> & { organization_id: string; item_id: string; access_token: string };
        Update: Partial<Database["public"]["Tables"]["bank_links"]["Row"]>;
        Relationships: [];
      };
      bank_accounts: {
        Row: {
          id: string;
          organization_id: string;
          link_id: string;
          account_id: string;
          name: string | null;
          official_name: string | null;
          mask: string | null;
          type: string | null;
          subtype: string | null;
          current_balance: number | null;
          available_balance: number | null;
          currency: string | null;
          balance_at: string | null;
          include: boolean;
          credit_limit: number | null;
          apr: number | null;
          minimum_payment: number | null;
          payment_due_day: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["bank_accounts"]["Row"]> & { organization_id: string; link_id: string; account_id: string };
        Update: Partial<Database["public"]["Tables"]["bank_accounts"]["Row"]>;
        Relationships: [];
      };
      bank_transactions: {
        Row: {
          id: string;
          organization_id: string;
          account_id: string;
          transaction_id: string;
          amount: number;
          posted_on: string;
          name: string | null;
          merchant: string | null;
          category: string | null;
          pending: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["bank_transactions"]["Row"]> & { organization_id: string; account_id: string; transaction_id: string; amount: number; posted_on: string };
        Update: Partial<Database["public"]["Tables"]["bank_transactions"]["Row"]>;
        Relationships: [];
      };
      ops_targets: {
        Row: {
          organization_id: string;
          evaluations_per_week: number;
          close_rate: number;
          weeks_booked_ahead: number;
          cash_on_hand: number | null;
          cash_as_of: string | null;
          cash_floor: number | null;
          marketing_share: number;
          auto_ramp: boolean;
          lever_costs: Json;
          owner_hours_per_week: number;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["ops_targets"]["Row"]> & { organization_id: string };
        Update: Partial<Database["public"]["Tables"]["ops_targets"]["Row"]>;
        Relationships: [];
      };
      ops_actions: {
        Row: {
          id: string;
          organization_id: string;
          mode: string;
          budget: number;
          plan: Json;
          made: Json;
          by: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["ops_actions"]["Row"]> & { organization_id: string; mode: string };
        Update: Partial<Database["public"]["Tables"]["ops_actions"]["Row"]>;
        Relationships: [];
      };
      summary_cache: {
        Row: {
          organization_id: string;
          key: string;
          value: Json | null;
          computed_at: string;
          took_ms: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["summary_cache"]["Row"]> & {
          organization_id: string;
          key: string;
        };
        Update: Partial<Database["public"]["Tables"]["summary_cache"]["Row"]>;
        Relationships: [];
      };
      marketing_plays: {
        Row: {
          id: string;
          organization_id: string;
          house_id: string;
          job_id: string | null;
          customer_id: string | null;
          /** evaluation | client: what set the play off. */
          reason: string;
          /** yard_sign | knocks | door_hangers | flyers */
          kind: string;
          quantity: number;
          zone_id: string | null;
          /** House ids for doors; route objects for flyers. */
          targets: Json;
          /** open | done | skipped */
          status: string;
          done_at: string | null;
          done_by: string | null;
          mailing_id: string | null;
          note: string | null;
          /** pending | approved | auto */
          approval: string;
          approved_at: string | null;
          approved_by: string | null;
          removed: Json;
          assigned_to: string | null;
          assigned_at: string | null;
          assigned_by: string | null;
          walk_order: Json;
          walk_order_line: Json;
          walk_order_set_at: string | null;
          walk_order_set_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["marketing_plays"]["Row"]> & {
          organization_id: string;
          house_id: string;
          reason: string;
          kind: string;
        };
        Update: Partial<Database["public"]["Tables"]["marketing_plays"]["Row"]>;
        Relationships: [];
      };
      house_kinds: {
        Row: {
          house_id: string;
          organization_id: string;
          /** home | townhome | condo | apartment | business | home_business | institution | land | unknown */
          kind: string;
          units_at_address: number;
          basis: string | null;
          classified_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["house_kinds"]["Row"]> & { house_id: string; organization_id: string; kind: string };
        Update: Partial<Database["public"]["Tables"]["house_kinds"]["Row"]>;
        Relationships: [];
      };
      house_ownership: {
        Row: {
          house_id: string;
          organization_id: string;
          account_id: string | null;
          owner_name: string | null;
          owner_mailing: string | null;
          /** true owner-occupied, false absentee, null unknown. */
          owner_occupied: boolean | null;
          occupancy_reason: string | null;
          principal_residence: boolean | null;
          last_sale_date: string | null;
          last_sale_price: number | null;
          year_built: number | null;
          land_use: string | null;
          assessed_value: number | null;
          source_layer: string | null;
          fetched_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["house_ownership"]["Row"]> & { house_id: string; organization_id: string };
        Update: Partial<Database["public"]["Tables"]["house_ownership"]["Row"]>;
        Relationships: [];
      };
      eddm_mailings: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          /** residential | all */
          audience: string;
          routes: Json;
          pieces: number;
          postage_per_piece: number | null;
          print_cost_per_piece: number;
          postage_cents: number;
          print_cost_cents: number;
          drop_facilities: Json;
          /** planned | printed | mailed */
          status: string;
          mailed_on: string | null;
          wave_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["eddm_mailings"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["eddm_mailings"]["Row"]>;
        Relationships: [];
      };
      eddm_routes: {
        Row: {
          id: string;
          organization_id: string;
          zip: string;
          /** USPS's route id within the ZIP, e.g. C012. */
          route_id: string;
          residential_count: number | null;
          business_count: number | null;
          total_count: number | null;
          /** Everything USPS sent about the route. */
          attributes: Json;
          /** Rings of [lng, lat] pairs: the boundary worked out from the streets. */
          rings: Json;
          /** The streets the carrier walks, as USPS sent them: paths of [lng, lat]. */
          paths: Json | null;
          source_url: string | null;
          fetched_at: string;
          /** USPS's route type: C city, R rural, H highway contract, B boxes. */
          route_type: string | null;
          /** walkable | hard | unknown */
          walkability: string;
          walkability_reason: string | null;
          main_roads: Json | null;
          wave_id: string | null;
          zone_id: string | null;
          house_count: number;
        };
        Insert: Partial<Database["public"]["Tables"]["eddm_routes"]["Row"]> & {
          organization_id: string;
          zip: string;
          route_id: string;
          rings: Json;
        };
        Update: Partial<Database["public"]["Tables"]["eddm_routes"]["Row"]>;
        Relationships: [];
      };
      gis_import_settings: {
        Row: {
          organization_id: string;
          /** Where the deployed app answers, for the scheduler to post to. */
          base_url: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["gis_import_settings"]["Row"]> & {
          organization_id: string;
          base_url: string;
        };
        Update: Partial<Database["public"]["Tables"]["gis_import_settings"]["Row"]>;
        Relationships: [];
      };
      house_match_reviews: {
        Row: {
          id: string;
          organization_id: string;
          house_id: string;
          property_id: string | null;
          customer_id: string | null;
          /** 0 to 1: how close the two addresses were. */
          score: number;
          status: string;
          /** The address that came in, for a reviewer to judge against. */
          incoming_address: string | null;
          incoming_normalized: string | null;
          parcel_id: string | null;
          source: string | null;
          /** The parcel's pin, so "different house" can be created on the spot. */
          incoming_lat: number | null;
          incoming_lng: number | null;
          /** same_house | different, once settled. */
          resolution: string | null;
          created_house_id: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["house_match_reviews"]["Row"]> & {
          organization_id: string;
          house_id: string;
          score: number;
        };
        Update: Partial<Database["public"]["Tables"]["house_match_reviews"]["Row"]>;
        Relationships: [];
      };
      inventory_codes: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          tool_id: string | null;
          material_id: string | null;
          storage_location: string | null;
          label: string | null;
          expected_quantity: number | null;
          active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["inventory_codes"]["Row"]> & {
          organization_id: string;
          code: string;
        };
        Update: Partial<Database["public"]["Tables"]["inventory_codes"]["Row"]>;
        Relationships: [];
      };
      inventory_movements: {
        Row: {
          id: string;
          organization_id: string;
          tool_id: string | null;
          material_id: string | null;
          code_id: string | null;
          direction: string;
          quantity: number;
          profile_id: string | null;
          job_id: string | null;
          note: string | null;
          happened_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["inventory_movements"]["Row"]> & {
          organization_id: string;
          direction: string;
          quantity: number;
        };
        Update: Partial<Database["public"]["Tables"]["inventory_movements"]["Row"]>;
        Relationships: [];
      };
      knowledge_units: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          plural: string | null;
          hours: number | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["knowledge_units"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_units"]["Row"]>;
        Relationships: [];
      };
      knowledge_tags: {
        Row: { id: string; organization_id: string; name: string; color: string | null; created_at: string };
        Insert: { organization_id: string; name: string; id?: string; color?: string | null };
        Update: Partial<{ id: string; organization_id: string; name: string; color: string | null }>;
        Relationships: [];
      };
      knowledge_node_tags: {
        Row: { node_id: string; tag_id: string };
        Insert: { node_id: string; tag_id: string };
        Update: Partial<{ node_id: string; tag_id: string }>;
        Relationships: [];
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
          evaluation_mode: string;
          referral_code: string | null;
          evaluation_status: string;
          project_start_date: string | null;
          project_end_date: string | null;
          client_notes: string | null;
          budget_range: string | null;
          referred_by_profile_id: string | null;
          cancelled_at: string | null;
          cancellation_reason: string | null;
          completed_at: string | null;
          photos_approved_at: string | null;
          photos_approved_by: string | null;
          pipeline_override_stage: string | null;
          pipeline_override_status: string | null;
          pipeline_override_from: string | null;
          pipeline_override_at: string | null;
          pipeline_override_by: string | null;
          pipeline_override_note: string | null;
          dispute_opened_at: string | null;
          dispute_resolved_at: string | null;
          dispute_kind: string | null;
          dispute_reason: string | null;
          dispute_opened_by: string | null;
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
          does_evaluations: boolean | null;
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
          schedule_requests: boolean;
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
      commission_payouts: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          job_id: string;
          amount: number;
          paid_at: string;
          method: string | null;
          reference: string | null;
          note: string | null;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["commission_payouts"]["Row"]> & {
          organization_id: string;
          profile_id: string;
          job_id: string;
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["commission_payouts"]["Row"]>;
        Relationships: [];
      };
      client_consent: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string;
          channel: "sms" | "email";
          state: "unknown" | "granted" | "revoked";
          source: string;
          evidence: string | null;
          changed_at: string;
          changed_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["client_consent"]["Row"]> & {
          organization_id: string;
          customer_id: string;
          channel: "sms" | "email";
        };
        Update: Partial<Database["public"]["Tables"]["client_consent"]["Row"]>;
        Relationships: [];
      };
      client_message_log: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          channel: "sms" | "email";
          kind: string;
          reference_id: string | null;
          dedupe_key: string;
          status: "sent" | "skipped" | "failed";
          skip_reason: string | null;
          detail: string | null;
          provider_id: string | null;
          body: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["client_message_log"]["Row"]> & {
          organization_id: string;
          channel: "sms" | "email";
          kind: string;
          dedupe_key: string;
          status: "sent" | "skipped" | "failed";
        };
        Update: Partial<Database["public"]["Tables"]["client_message_log"]["Row"]>;
        Relationships: [];
      };
      reminder_rules: {
        Row: {
          organization_id: string;
          kind: string;
          enabled: boolean;
          channels: string[];
          offsets_hours: number[];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["reminder_rules"]["Row"]> & {
          organization_id: string;
          kind: string;
        };
        Update: Partial<Database["public"]["Tables"]["reminder_rules"]["Row"]>;
        Relationships: [];
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
          granted: boolean;
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
          resale_value: number | null;
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
          description: string | null;
          kit_quantities: Record<string, number>;
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
          category: string;
          kind: string;
          resale_value: number | null;
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
          scope_template: string | null;
          performed_by: string;
          partner_name: string | null;
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
          image_bearing: number;
          orientation_confirmed: boolean;
          image_real_width_feet: number | null;
          image_uploaded: boolean;
          locked: boolean;
          property_line: Json;
          marks: Json;
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
      proposal_views: {
        Row: {
          id: string;
          proposal_id: string;
          viewed_at: string;
          visitor_hash: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["proposal_views"]["Row"]> & {
          proposal_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["proposal_views"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "proposal_views_proposal_id_fkey";
            columns: ["proposal_id"];
            referencedRelation: "job_proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      proposal_events: {
        Row: {
          id: string;
          proposal_id: string;
          /** 'section' (time on screen) or 'click' (a decision). */
          kind: string;
          target: string;
          label: string | null;
          /** Measured on-screen seconds. Always zero on a click. */
          seconds: number;
          at: string;
          /** Salted per proposal, so nobody can be followed between two. */
          visitor_hash: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["proposal_events"]["Row"]> & {
          proposal_id: string;
          kind: string;
          target: string;
        };
        Update: Partial<Database["public"]["Tables"]["proposal_events"]["Row"]>;
        Relationships: [];
      };
      job_tips: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          /** A client's whole access to the tip page. They have no account. */
          token: string;
          /** asked | unpaid | paid | declined */
          status: string;
          amount_cents: number | null;
          /** What the job came to when the link was minted. */
          job_total_cents: number | null;
          message: string | null;
          checkout_session_id: string | null;
          paid_at: string | null;
          declined_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_tips"]["Row"]> & {
          organization_id: string;
          job_id: string;
          token: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_tips"]["Row"]>;
        Relationships: [];
      };
      recurring_decisions: {
        Row: {
          id: string;
          organization_id: string;
          merchant_key: string;
          label: string | null;
          kind: string | null;
          confirmed_at: string | null;
          dismissed_at: string | null;
          cancel_wanted: boolean;
          overhead_group: string | null;
          note: string | null;
          /** Counts even though no rhythm was found: a real cost billed irregularly. */
          included_at: string | null;
          /** 'median' or 'latest'. Null prices it from the median of every charge. */
          amount_basis: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["recurring_decisions"]["Row"]> & {
          organization_id: string;
          merchant_key: string;
        };
        Update: Partial<Database["public"]["Tables"]["recurring_decisions"]["Row"]>;
        Relationships: [];
      };
      fleet_assets: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          kind: string;
          year: number | null;
          make: string | null;
          model: string | null;
          mileage: number | null;
          condition: string;
          breakdowns_12mo: number;
          last_breakdown_on: string | null;
          monthly_cost: number | null;
          resale_value: number | null;
          tow_rating_lb: number | null;
          notes: string | null;
          retired_on: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["fleet_assets"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["fleet_assets"]["Row"]>;
        Relationships: [];
      };
      fleet_targets: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          kind: string;
          cost_cents: number | null;
          deposit_cents: number | null;
          monthly_cents: number | null;
          replaces_asset_id: string | null;
          priority: number;
          tow_rating_lb: number | null;
          url: string | null;
          notes: string | null;
          ordered_on: string | null;
          bought_on: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["fleet_targets"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["fleet_targets"]["Row"]>;
        Relationships: [];
      };
      outreach_links: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          code: string;
          kind: string;
          platform: string;
          audience: string | null;
          from_page: string | null;
          sent_to: string | null;
          service: string | null;
          screenshot_path: string | null;
          note: string | null;
          click_count: number;
          first_click_at: string | null;
          last_click_at: string | null;
          responded_at: string | null;
          response: string | null;
          response_note: string | null;
          comment: string | null;
          posted_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["outreach_links"]["Row"]> & {
          organization_id: string;
          profile_id: string;
          code: string;
          platform: string;
        };
        Update: Partial<Database["public"]["Tables"]["outreach_links"]["Row"]>;
        Relationships: [];
      };
      outreach_clicks: {
        Row: {
          id: string;
          organization_id: string;
          link_id: string;
          clicked_at: string;
          source: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["outreach_clicks"]["Row"]> & {
          organization_id: string;
          link_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["outreach_clicks"]["Row"]>;
        Relationships: [];
      };
      kit_containers: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          kits: number[];
          kind: string;
          quantity: number | null;
          cost: number | null;
          purchase_url: string | null;
          broken: number;
          on_order: boolean;
          reorder_threshold: number | null;
          image_path: string | null;
          notes: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["kit_containers"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["kit_containers"]["Row"]>;
        Relationships: [];
      };
      kit_container_parts: {
        Row: {
          id: string;
          organization_id: string;
          container_id: string;
          name: string;
          quantity: number;
          cost: number | null;
          purchase_url: string | null;
          broken: number;
          on_order: boolean;
          notes: string | null;
          position: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["kit_container_parts"]["Row"]> & {
          organization_id: string;
          container_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["kit_container_parts"]["Row"]>;
        Relationships: [];
      };
      community_groups: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          area: string | null;
          platform: string;
          external_url: string | null;
          member_count: number | null;
          business_post_cents: number | null;
          pass_days: number;
          decline_message: string | null;
          block_words: string[];
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["community_groups"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["community_groups"]["Row"]>;
        Relationships: [];
      };
      group_post_passes: {
        Row: {
          id: string;
          organization_id: string;
          group_id: string;
          business_name: string;
          contact_name: string | null;
          email: string | null;
          phone: string | null;
          code: string;
          amount_cents: number;
          status: string;
          checkout_session_id: string | null;
          paid_at: string | null;
          expires_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["group_post_passes"]["Row"]> & {
          organization_id: string;
          group_id: string;
          business_name: string;
          code: string;
          amount_cents: number;
        };
        Update: Partial<Database["public"]["Tables"]["group_post_passes"]["Row"]>;
        Relationships: [];
      };
      community_group_posts: {
        Row: {
          id: string;
          organization_id: string;
          group_id: string;
          kind: string;
          service: string | null;
          urgency: string | null;
          author_name: string | null;
          summary: string | null;
          matched_words: string[];
          posted_text: string | null;
          screenshot_path: string | null;
          handled_at: string | null;
          handled_note: string | null;
          recommendation_id: string | null;
          posted_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["community_group_posts"]["Row"]> & {
          organization_id: string;
          group_id: string;
          kind: string;
        };
        Update: Partial<Database["public"]["Tables"]["community_group_posts"]["Row"]>;
        Relationships: [];
      };
      payments_health: {
        Row: {
          organization_id: string;
          state: string;
          detail: string | null;
          checked_at: string;
          changed_at: string;
          last_alert_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["payments_health"]["Row"]> & {
          organization_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["payments_health"]["Row"]>;
        Relationships: [];
      };
      job_proposals: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          token: string;
          status: string;
          payment_path: string | null;
          payment_path_at: string | null;
          client_chosen_day: string | null;
          client_chosen_day_at: string | null;
          checkout_session_id: string | null;
          paid_at: string | null;
          total_cost: number | null;
          discount_id: string | null;
          discount_kind: string | null;
          discount_value: number | null;
          discount_amount: number;
          discount_reason: string | null;
          scope_snapshot: unknown;
          site_image_path: string | null;
          site_image_transform: unknown;
          recommended_scope: string | null;
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
      /** Positive evidence that something needed for a job is actually in hand. */
      job_confirmations: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          /** materials | equipment | access */
          kind: string;
          /** not_required | required_unconfirmed | confirmed */
          state: string;
          note: string | null;
          confirmed_by: string | null;
          confirmed_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_confirmations"]["Row"]> & {
          organization_id: string;
          job_id: string;
          kind: string;
          state: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_confirmations"]["Row"]>;
        Relationships: [];
      };
      /** What is happening about a balance nobody is going to pay in the ordinary way. */
      job_financial_dispositions: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          /** waived | written_off | refunded | payment_plan | disputed | collections */
          state: string;
          reason: string;
          decided_by: string | null;
          decided_at: string;
          cleared_at: string | null;
          cleared_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["job_financial_dispositions"]["Row"]> & {
          organization_id: string;
          job_id: string;
          state: string;
          reason: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_financial_dispositions"]["Row"]>;
        Relationships: [];
      };
      /** One way to say something is wrong on a job. */
      job_issues: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          customer_id: string | null;
          property_id: string | null;
          type: string;
          severity: string;
          title: string;
          description: string | null;
          status: string;
          owner_id: string | null;
          created_by: string | null;
          created_at: string;
          due_at: string | null;
          /** Its own field, not read off the severity: a manager can decide otherwise. */
          blocking: boolean;
          blocking_stage: string | null;
          resolution: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_issues"]["Row"]> & {
          organization_id: string;
          job_id: string;
          type: string;
          severity: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_issues"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_issues_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      /** A failed check somebody took responsibility for letting past. */
      job_gate_overrides: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          gate: string;
          check_key: string;
          reason: string;
          overridden_by: string | null;
          overridden_at: string;
          withdrawn_at: string | null;
          withdrawn_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["job_gate_overrides"]["Row"]> & {
          organization_id: string;
          job_id: string;
          gate: string;
          check_key: string;
          reason: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_gate_overrides"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_gate_overrides_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Money that came in and then went back out again. */
      payment_adjustments: {
        Row: {
          id: string;
          organization_id: string;
          payment_id: string;
          job_id: string | null;
          /** refund | chargeback | reversal | void | correction */
          kind: string;
          amount_cents: number;
          reason: string;
          /** The processor's own id, so one webhook delivered twice deducts once. */
          external_id: string | null;
          recorded_by: string | null;
          occurred_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payment_adjustments"]["Row"]> & {
          organization_id: string;
          payment_id: string;
          kind: string;
          amount_cents: number;
          reason: string;
        };
        Update: Partial<Database["public"]["Tables"]["payment_adjustments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "payment_adjustments_payment_id_fkey";
            columns: ["payment_id"];
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      /** What the work told the marketing: one opportunity per job, kind and week. */
      marketing_events: {
        Row: {
          id: string;
          organization_id: string;
          /** evaluation_booked | job_scheduled | job_started | job_completed */
          kind: string;
          job_id: string | null;
          property_id: string | null;
          customer_id: string | null;
          zone_id: string | null;
          /** The Monday of the week: two events in one week are one trip. */
          window_start: string;
          occurred_at: string;
          source: string | null;
          detail: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["marketing_events"]["Row"]> & {
          organization_id: string;
          kind: string;
          window_start: string;
        };
        Update: Partial<Database["public"]["Tables"]["marketing_events"]["Row"]>;
        Relationships: [];
      };
      job_photos: {
        Row: {
          id: string;
          job_id: string;
          organization_id: string;
          path: string;
          kind: string;
          /**
           * When in the job's life it was taken: evaluation | prework |
           * progress | after | issue. Distinct from `kind`, which cannot tell
           * a photo from the evaluation apart from one taken on the morning.
           */
          phase?: string | null;
          /** The visit it was taken on, where there is one. */
          work_session_id?: string | null;
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
          reference_label: string | null;
          reference_kind: string | null;
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
      /** A field report that something did not go as sold. */
      job_exceptions: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          work_session_id: string | null;
          kind: string;
          state: string;
          summary: string;
          detail: string | null;
          /** The reporter's own answer to "can you carry on". Not a verdict on the job. */
          blocks_work: boolean;
          issue_id: string | null;
          scope_change_id: string | null;
          reported_by: string | null;
          reported_at: string;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
          resolution: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_exceptions"]["Row"]> & {
          organization_id: string;
          job_id: string;
          kind: string;
          summary: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_exceptions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_exceptions_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      /** The only route by which the work a crew is asked to do can grow. */
      job_scope_changes: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          exception_id: string | null;
          requested_by: string | null;
          requested_at: string;
          requested_note: string;
          proposed: Json;
          status: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          price_cents: number | null;
          terms: string | null;
          priced_by: string | null;
          priced_at: string | null;
          client_approval_required: boolean;
          approval_waived_reason: string | null;
          sent_to_client_at: string | null;
          client_decision: string | null;
          client_decision_at: string | null;
          client_decision_note: string | null;
          client_decision_channel: string | null;
          client_decision_recorded_by: string | null;
          /** Stamped by trigger on approval. Null means the crew may not do it. */
          executable_at: string | null;
          supersedes_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_scope_changes"]["Row"]> & {
          organization_id: string;
          job_id: string;
          requested_note: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_scope_changes"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_scope_changes_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Which bits of the job got done, and why the rest did not. */
      job_work_progress: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          unit_kind: string;
          unit_key: string;
          unit_label: string | null;
          state: string;
          portion_pct: number | null;
          note: string | null;
          exception_id: string | null;
          work_session_id: string | null;
          recorded_by: string | null;
          recorded_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_work_progress"]["Row"]> & {
          organization_id: string;
          job_id: string;
          unit_kind: string;
          unit_key: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_work_progress"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_work_progress_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Who was on the job, including who used to be. Written by trigger from job_crew. */
      job_crew_assignments: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          profile_id: string;
          role: string;
          assigned_by: string | null;
          assigned_at: string;
          unassigned_at: string | null;
          unassigned_by: string | null;
          unassign_reason: string | null;
          replaced_by_profile_id: string | null;
          exception_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_crew_assignments"]["Row"]> & {
          organization_id: string;
          job_id: string;
          profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_crew_assignments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "job_crew_assignments_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Append-only. The database refuses an UPDATE or a DELETE on this table. */
      job_audit_events: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          subject_kind: string;
          subject_id: string;
          action: string;
          from_state: string | null;
          to_state: string | null;
          actor: string | null;
          actor_roles: string[];
          note: string | null;
          detail: Json;
          at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_audit_events"]["Row"]> & {
          organization_id: string;
          job_id: string;
          subject_kind: string;
          subject_id: string;
          action: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "job_audit_events_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Time the owner (or anybody senior) lost to the work, by category. */
      owner_interventions: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          occurred_on: string;
          minutes: number;
          category: string;
          job_id: string | null;
          note: string | null;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["owner_interventions"]["Row"]> & {
          organization_id: string;
          profile_id: string;
          minutes: number;
          category: string;
        };
        Update: Partial<Database["public"]["Tables"]["owner_interventions"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      /** The post-import integrity questions, answered in one trip. */
      gis_integrity_report: {
        Args: { org: string };
        Returns: Json;
      };
      /** One scheduler tick: asks for a step on every runnable import. */
      gis_import_tick: {
        Args: Record<string, never>;
        Returns: number;
      };
      eddm_rebuild_segments: { Args: { org: string; the_zip: string }; Returns: number };
      eddm_assign_houses: { Args: { org: string; the_zip: string; max_m?: number; part?: number; parts?: number }; Returns: Json };
      eddm_materialize_zones: { Args: { org: string; the_zip: string }; Returns: Json };
      eddm_unserved_cells: { Args: { org: string }; Returns: Json };
      houses_unserved_points: { Args: { org: string }; Returns: Json };
      houses_zip_counts: { Args: { org: string }; Returns: Json };
      ownership_summary: { Args: { org: string }; Returns: Json };
      house_facts: { Args: { org: string; the_house: string }; Returns: Json };
      house_nearest: { Args: { org: string; at_lat: number; at_lng: number }; Returns: string | null };
      relationship_ownership_matrix: { Args: { org: string }; Returns: Json };
      zone_adopt_leftovers: { Args: { org: string; the_zip: string | null }; Returns: number };
      zone_ensure: { Args: { org: string; the_zip: string }; Returns: Json };
      zone_outline: { Args: { the_zone: string; reach?: number; context?: number }; Returns: Json };
      zone_walk: { Args: { the_zone: string }; Returns: Json };
      zone_build: { Args: { the_zone: string }; Returns: Json };
      zone_dedupe: { Args: { org: string }; Returns: Json };
      zones_geojson: { Args: { org: string }; Returns: Json };
      zone_settle: { Args: { the_zone: string }; Returns: Json };
      zone_absorb_enclaves: { Args: { org: string; the_zip: string | null }; Returns: Json };
      zone_split_pieces: { Args: { org: string; the_zip: string | null }; Returns: Json };
      zone_merge_small: { Args: { org: string; the_zip: string | null; max_houses?: number }; Returns: Json };
      zone_enclave_count: { Args: { org: string }; Returns: Json };
      zones_list: { Args: { org: string }; Returns: Json };
      marketing_sync: { Args: { org: string }; Returns: Json };
      marketing_sync_and_refresh: { Args: { org: string }; Returns: Json };
      roads_load_tile: { Args: { org: string; the_tile: string; rows: Json; replace?: boolean }; Returns: number };
      zones_rewalk_tick: { Args: { n?: number }; Returns: number };
      zones_rewalk_pending: { Args: { org: string }; Returns: number };
      zone_review: { Args: { org: string; the_zone: string; decision: string; reason?: string | null; note?: string | null; new_mode?: string | null; by?: string | null }; Returns: Json };
      zone_approvals: { Args: { org: string }; Returns: Json };
      bank_status: { Args: { org: string }; Returns: Json };
      bank_cash: { Args: { org: string }; Returns: number };
      ops_pulse: { Args: { org: string }; Returns: Json };
      ops_ramp: { Args: { org: string; the_mode: string; budget: number; plan: Json; by?: string | null; note?: string | null }; Returns: Json };
      ops_actions_list: { Args: { org: string; n?: number }; Returns: Json };
      summary_get: { Args: { org: string; the_key: string; max_age?: string }; Returns: Json };
      summary_refresh: { Args: { org: string; the_key: string }; Returns: Json };
      summaries_refresh: { Args: { org: string; keys?: string[] | null }; Returns: Json };
      marketing_play_set: { Args: { the_play: string; new_status: string; by: string | null; designs?: number }; Returns: Json };
      marketing_plays_list: { Args: { org: string; include_done?: boolean }; Returns: Json };
      marketing_knock_targets: { Args: { the_house: string }; Returns: Json };
      marketing_hanger_targets: { Args: { the_house: string; wanted?: number; max_m?: number | null; skip?: string[] }; Returns: Json };
      marketing_play_doors: { Args: { the_play: string }; Returns: Json };
      marketing_play_review: { Args: { org: string; the_play: string; decision: string; remove?: string[] | null; set_quantity?: number | null; note?: string | null; by?: string | null }; Returns: Json };
      marketing_approval_state: { Args: { org: string }; Returns: Json };
      marketing_defaults_set: { Args: { org: string; the_kind: string; the_quantity: number | null; the_reach: number | null }; Returns: undefined };
      marketing_flyer_routes: { Args: { the_house: string; wanted?: number }; Returns: Json };
      zone_is_active: { Args: { the_zone: string }; Returns: boolean };
      classify_houses: { Args: { org: string; the_zip: string | null }; Returns: Json };
      kind_summary: { Args: { org: string }; Returns: Json };
      /** The doors inside a drawn shape: count, stage breakdown, print run by design. */
      houses_coverage: {
        Args: { org: string; ring: Json | null; zips: Json | null; designs?: number };
        Returns: Json;
      };
      /** The doors inside a drawn shape, one row each, for the walker's sheet. */
      houses_door_list: {
        Args: { org: string; ring: Json | null; zips: Json | null; designs?: number; max_rows?: number };
        Returns: Json;
      };
      /** The weed guide as it ships, put in for a business that has none. */
      weeds_install: {
        Args: { org: string; rows: Json };
        Returns: number;
      };
      /** One weed for the page its printed QR opens. Readable without a login. */
      weed_by_code: {
        Args: { the_code: string };
        Returns: Json;
      };
      /** Every mappable house as [lng, lat, stageRank], in one JSON value. */
      houses_map_points: {
        Args: { org: string };
        Returns: Json;
      };
      /** The houses inside a map viewport, and whether anything has happened to each. */
      /** Sold scope plus what the client has approved since. */
      job_executable_additions: {
        Args: { job: string };
        Returns: {
          scope_change_id: string;
          requested_note: string;
          proposed: Json;
          price_cents: number | null;
          terms: string | null;
          approved_at: string;
        }[];
      };
      /** What is waiting on somebody, per job, for the boards. */
      jobs_with_open_exceptions: {
        Args: { org: string };
        Returns: {
          job_id: string;
          open_exceptions: number;
          blocking_exceptions: number;
          awaiting_review: number;
          awaiting_client: number;
        }[];
      };
      /** Owner time and owner-only decisions, by week. */
      owner_intervention_load: {
        Args: { org: string; weeks?: number };
        Returns: {
          week_start: string;
          logged_minutes: number;
          entries: number;
          top_category: string | null;
          top_category_minutes: number;
          owner_touches: number;
        }[];
      };
      /** One round's doors in the order the zone is actually walked. */
      marketing_play_route: { Args: { the_play: string }; Returns: Json };
      /** Say what order a round is walked in, by hand. */
      marketing_play_set_order: {
        Args: { org: string; the_play: string; order_ids: string[] | null; line?: Json; by?: string | null };
        Returns: Json;
      };
      /** Put doors back on a round. Only houses inside its own zone. */
      marketing_play_add_doors: {
        Args: { org: string; the_play: string; add: string[]; by?: string | null };
        Returns: Json;
      };
      houses_in_bbox: {
        Args: { org: string; min_lat: number; min_lng: number; max_lat: number; max_lng: number; max_rows?: number };
        Returns: { id: string; address: string; lat: number; lng: number; untouched: boolean }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
