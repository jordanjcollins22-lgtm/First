-- Admin-only Journey Dashboard: maps how each role (or the client) moves
-- through the system step by step, so friction/bottlenecks can be spotted
-- and removed. Steps are DATA, not code — new roles, branches, and steps
-- are added by inserting rows, never by touching the app.
--
-- role_key is a free label ("client", "evaluator", "admin", ...) rather than
-- a foreign key into roles(name): the client journey isn't a real account
-- role at all, and different businesses may name their roles differently.

create table if not exists journeys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  role_key text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, role_key)
);

drop trigger if exists set_updated_at on journeys;
create trigger set_updated_at before update on journeys for each row execute function set_updated_at();

create table if not exists journey_steps (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references journeys(id) on delete cascade,
  step_key text not null,
  order_index integer not null default 0,
  label text not null,
  -- HUMAN | AUTOMATED | HUMAN_APPROVAL | CUSTOMER_ACTION | SYSTEM_ACTION
  step_type text not null default 'human',
  role_label text,
  inputs text[] not null default '{}',
  outputs text[] not null default '{}',
  automations text[] not null default '{}',
  -- step_keys this can lead to — a step with >1 is a branch, several steps
  -- sharing a next_steps entry converge into it (e.g. every lead source
  -- converging into "lead_in_crm").
  next_steps text[] not null default '{}',
  clicks integer not null default 0,
  manual_inputs integer not null default 0,
  customer_comms integer not null default 0,
  internal_comms integer not null default 0,
  texts integer not null default 0,
  emails integer not null default 0,
  calls integer not null default 0,
  est_minutes numeric,
  -- false = this step is part of the intended journey but doesn't exist in
  -- the app yet — the dashboard's whole point is to surface these gaps.
  is_built boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (journey_id, step_key)
);

drop trigger if exists set_updated_at on journey_steps;
create trigger set_updated_at before update on journey_steps for each row execute function set_updated_at();
alter table journey_steps drop constraint if exists journey_steps_step_type_check;
alter table journey_steps add constraint journey_steps_step_type_check
  check (step_type in ('human', 'automated', 'human_approval', 'customer_action', 'system_action'));

alter table journeys enable row level security;
drop policy if exists "admin_manage_journeys" on journeys;
create policy "admin_manage_journeys" on journeys for all to authenticated
  using (is_admin() and organization_id = current_org_id())
  with check (is_admin() and organization_id = current_org_id());

alter table journey_steps enable row level security;
drop policy if exists "admin_manage_journey_steps" on journey_steps;
create policy "admin_manage_journey_steps" on journey_steps for all to authenticated
  using (is_admin() and exists (
    select 1 from journeys j where j.id = journey_steps.journey_id and j.organization_id = current_org_id()
  ))
  with check (is_admin() and exists (
    select 1 from journeys j where j.id = journey_steps.journey_id and j.organization_id = current_org_id()
  ));

-- Seed data for the default org: the Evaluator journey as the app actually
-- works today, and the Client journey from lead source to outcome. Gaps
-- called for in the product spec but not yet built (voice notes, proposal
-- generation, Account Manager approval) are included as is_built = false so
-- they show up as flagged opportunities, not silently missing.

insert into journeys (organization_id, role_key, name, description)
values
  ('00000000-0000-0000-0000-000000000001', 'evaluator', 'Evaluator Journey', 'From an assigned evaluation to submitting it.'),
  ('00000000-0000-0000-0000-000000000001', 'client', 'Client Journey', 'From first contact through every lead source to a completed project.')
on conflict (organization_id, role_key) do nothing;

do $$
declare
  eval_id uuid;
  client_id uuid;
begin
  select id into eval_id from journeys where organization_id = '00000000-0000-0000-0000-000000000001' and role_key = 'evaluator';
  select id into client_id from journeys where organization_id = '00000000-0000-0000-0000-000000000001' and role_key = 'client';

  if eval_id is not null then
    insert into journey_steps (journey_id, step_key, order_index, label, step_type, role_label, inputs, outputs, automations, next_steps, clicks, manual_inputs, customer_comms, internal_comms, texts, emails, calls, est_minutes, is_built, notes)
    values
      (eval_id, 'assigned', 0, 'Open Assigned Evaluation', 'human', 'Evaluator',
        '{}', '{"Customer, property, requested work, notes on screen"}', '{}', '{"on_my_way"}',
        1, 0, 0, 0, 0, 0, 0, 0.5, true, 'My Evaluations page lists assigned evaluations.'),
      (eval_id, 'on_my_way', 1, 'On My Way', 'human', 'Evaluator',
        '{}', '{"Status = on_way", "Timestamp"}', '{"Notify customer", "Visible to Admin"}', '{"arrived"}',
        1, 0, 1, 1, 0, 0, 0, 0.1, true, null),
      (eval_id, 'arrived', 2, 'Arrived', 'human', 'Evaluator',
        '{}', '{"Status = arrived", "Timestamp"}', '{"Record travel duration"}', '{"start_evaluation"}',
        1, 0, 0, 1, 0, 0, 0, 0.1, true, null),
      (eval_id, 'start_evaluation', 3, 'Start Evaluation', 'human', 'Evaluator',
        '{}', '{"Status = completed on submit", "Duration tracking starts"}', '{}', '{"draw_area"}',
        1, 0, 0, 0, 0, 0, 0, 0.1, true, null),
      (eval_id, 'draw_area', 4, 'Draw Area', 'human', 'Evaluator',
        '{"Location", "Length x width"}', '{"Zone drawn on map", "Area/perimeter derived"}', '{}', '{"select_service"}',
        3, 2, 0, 0, 0, 0, 0, 2, true, 'Area/perimeter are derived from L x W, not typed separately.'),
      (eval_id, 'select_service', 5, 'Select Service', 'human', 'Evaluator',
        '{"Service choice"}', '{"Service attached to zone"}', '{"Auto-attach tool checklist", "Auto-attach linked materials"}', '{"customer_questions"}',
        1, 0, 0, 0, 0, 0, 0, 0.3, true, 'Evaluator can also propose a brand-new service on the spot.'),
      (eval_id, 'customer_questions', 6, 'Ask Customer Questions', 'human', 'Evaluator',
        '{"Tap-select answers", "Material type/color when a material has options"}', '{"Zone field values", "Material choices"}', '{"Skip asking about materials with no defined options"}', '{"measurements"}',
        4, 3, 0, 0, 0, 0, 0, 2, true, null),
      (eval_id, 'voice_notes', 7, 'Voice Note for Extra Context', 'human', 'Evaluator',
        '{"Spoken note"}', '{"Audio recording", "Transcription attached to zone"}', '{"Auto-transcribe"}', '{"measurements"}',
        0, 0, 0, 0, 0, 0, 0, null, false, 'Not built yet — notes are typed only today.'),
      (eval_id, 'measurements', 8, 'Confirm Measurements', 'human', 'Evaluator',
        '{}', '{"Area/perimeter used for pricing"}', '{}', '{"photos"}',
        0, 0, 0, 0, 0, 0, 0, 0, true, 'Captured as part of Draw Area — never asked twice.'),
      (eval_id, 'photos', 9, 'Photos', 'human', 'Evaluator',
        '{"Camera or library photos"}', '{"Photos attached to zone"}', '{}', '{"notes"}',
        2, 1, 0, 0, 0, 0, 0, 1, true, null),
      (eval_id, 'notes', 10, 'Notes', 'human', 'Evaluator',
        '{"Typed note"}', '{"Notes attached to zone"}', '{}', '{"complete_area"}',
        1, 1, 0, 0, 0, 0, 0, 0.5, true, null),
      (eval_id, 'complete_area', 11, 'Complete Area / Another Area?', 'human', 'Evaluator',
        '{"Yes/No"}', '{}', '{}', '{"draw_area", "submit_evaluation"}',
        1, 0, 0, 0, 0, 0, 0, 0.1, true, 'Loops back to Draw Area, or moves on to Submit.'),
      (eval_id, 'submit_evaluation', 12, 'Submit Evaluation', 'human', 'Evaluator',
        '{}', '{"Evaluation marked complete"}', '{}', '{"generate_proposal"}',
        1, 0, 0, 0, 0, 0, 0, 0.1, true, 'One click — no missing-info check yet.'),
      (eval_id, 'generate_proposal', 13, 'Generate Customer Proposal + Internal Scope', 'automated', 'System',
        '{"Evaluation data"}', '{"Customer-facing proposal", "Internal scope"}', '{"Auto-populate from evaluation"}', '{"am_review"}',
        0, 0, 0, 0, 0, 0, 0, null, false, 'Not built yet — no proposal/scope generation exists today.'),
      (eval_id, 'am_review', 14, 'Account Manager Review & Approve', 'human_approval', 'Account Manager',
        '{"Generated proposal", "Internal scope"}', '{"Approved proposal"}', '{}', '{"send_proposal"}',
        0, 0, 0, 0, 0, 0, 0, null, false, 'Not built yet — no AM review queue exists today.'),
      (eval_id, 'send_proposal', 15, 'Send Proposal to Customer', 'automated', 'System',
        '{"Approved proposal"}', '{"Delivered proposal", "CRM stage updated"}', '{"Send", "Timestamp delivery"}', '{}',
        0, 0, 1, 0, 0, 1, 0, null, false, 'Not built yet.')
    on conflict (journey_id, step_key) do nothing;
  end if;

  if client_id is not null then
    insert into journey_steps (journey_id, step_key, order_index, label, step_type, role_label, inputs, outputs, automations, next_steps, clicks, manual_inputs, customer_comms, internal_comms, texts, emails, calls, est_minutes, is_built, notes)
    values
      (client_id, 'source_facebook', 0, 'Facebook Ads', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, false, 'Lead-source tracking not wired up per channel yet.'),
      (client_id, 'source_google_ads', 0, 'Google Ads', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, false, null),
      (client_id, 'source_gbp', 0, 'Google Business Profile', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, false, null),
      (client_id, 'source_website', 0, 'Website', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, true, 'GHL webhook creates the customer/job automatically.'),
      (client_id, 'source_affiliate', 0, 'Affiliate Link', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, false, null),
      (client_id, 'source_referral', 0, 'Referral', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, false, null),
      (client_id, 'source_existing', 0, 'Existing Customer', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, true, 'Adding a new property for an existing customer reuses that customer record.'),
      (client_id, 'source_phone', 0, 'Phone Call', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,1, null, true, 'Entered manually via New Property.'),
      (client_id, 'source_text', 0, 'Text Message', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,1,0,0, null, false, null),
      (client_id, 'source_door', 0, 'Door-to-Door', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, true, 'Entered manually via New Property.'),
      (client_id, 'source_direct_mail', 0, 'Direct Mail', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, false, null),
      (client_id, 'source_yard_sign', 0, 'Yard Sign', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, false, null),
      (client_id, 'source_manual', 0, 'Manual Lead', 'customer_action', 'Lead', '{}', '{"Lead"}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, true, 'Entered manually via New Property.'),

      (client_id, 'lead_in_crm', 1, 'Lead Enters the System', 'system_action', 'System', '{"Name, contact info, address"}', '{"Customer + property + job created"}', '{"De-dupe by matching existing customer/property"}', '{"evaluation_scheduled"}', 0,1,0,0,0,0,0, 1, true, 'Every entry path converges here — one operating system, not one per channel.'),
      (client_id, 'evaluation_scheduled', 2, 'Evaluation Scheduled', 'human', 'Admin/AM', '{"Date/time"}', '{"Evaluation assigned to evaluator"}', '{}', '{"evaluation_completed", "lost_lead"}', 2,1,1,0,1,0,0, 1, true, null),
      (client_id, 'evaluation_completed', 3, 'Evaluation Completed', 'human', 'Evaluator', '{}', '{"Zones, services, materials, photos, notes"}', '{}', '{"proposal_sent", "unqualified"}', 0,0,0,0,0,0,0, null, true, 'This is the full Evaluator Journey.'),
      (client_id, 'proposal_sent', 4, 'Proposal Sent', 'automated', 'System', '{"Evaluation data"}', '{"Customer proposal"}', '{}', '{"proposal_approved", "proposal_declined", "proposal_revision"}', 0,0,1,0,0,1,0, null, false, 'Not built yet.'),
      (client_id, 'proposal_approved', 5, 'Proposal Approved', 'customer_action', 'Customer', '{}', '{"Project scheduled"}', '{}', '{"project_completed"}', 1,0,1,0,0,0,0, null, false, 'Not built yet.'),
      (client_id, 'proposal_declined', 5, 'Proposal Declined', 'customer_action', 'Customer', '{}', '{}', '{}', '{}', 0,0,0,0,0,0,0, null, false, 'Not built yet.'),
      (client_id, 'proposal_revision', 5, 'Proposal Revision Requested', 'customer_action', 'Customer', '{}', '{"Revised proposal"}', '{}', '{"proposal_sent"}', 0,0,1,0,0,0,1, null, false, 'Not built yet.'),
      (client_id, 'lost_lead', 3, 'Lost Lead', 'human', 'Admin/AM', '{}', '{}', '{}', '{}', 0,0,0,0,0,0,0, null, true, null),
      (client_id, 'unqualified', 4, 'Unqualified Lead', 'human', 'Admin/AM', '{}', '{}', '{}', '{}', 0,0,0,0,0,0,0, null, true, null),
      (client_id, 'project_completed', 6, 'Project Completed', 'human', 'Crew', '{}', '{}', '{}', '{"repeat_customer", "upsell", "referral", "lost_customer"}', 0,0,1,0,0,0,0, null, true, null),
      (client_id, 'repeat_customer', 7, 'Repeat Customer', 'customer_action', 'Customer', '{}', '{}', '{}', '{"lead_in_crm"}', 0,0,0,0,0,0,0, null, true, 'A repeat property reuses the existing customer record automatically.'),
      (client_id, 'upsell', 7, 'Upsell', 'human', 'Admin/AM', '{}', '{}', '{}', '{}', 0,0,1,0,0,0,0, null, false, 'No systematic upsell prompt yet.'),
      (client_id, 'referral', 7, 'Referral', 'customer_action', 'Customer', '{}', '{"New lead"}', '{}', '{"source_referral"}', 0,0,0,0,0,0,0, null, false, 'Not tracked back to the referring customer yet.'),
      (client_id, 'lost_customer', 7, 'Lost Customer', 'human', 'Admin/AM', '{}', '{}', '{}', '{}', 0,0,0,0,0,0,0, null, true, null)
    on conflict (journey_id, step_key) do nothing;
  end if;
end $$;
