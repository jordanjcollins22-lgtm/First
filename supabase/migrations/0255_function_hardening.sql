-- Function hardening, from the Supabase security linter.
--
-- Two things. First, every function of ours gets a fixed search_path, so a
-- caller cannot make one of them resolve a table name against a schema
-- they created. Second, the internal SECURITY DEFINER functions that a
-- stranger with the anon key could call over the REST API are closed to
-- anon. They run as the database owner; nothing outside the app should be
-- able to run them at all.
--
-- Left alone on purpose: current_org_id, has_role, is_admin,
-- is_superadmin and assert_own_org, which row-level security policies
-- call for whoever is asking, anon included. And weed_by_code, which is
-- the one public page that reads through the anon key by design.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'raise_double_booking', 'assert_evaluation_free', 'assert_visit_free', 'assert_crew_free',
         'assign_job_number', 'normalize_address', 'gis_integrity_report', 'houses_in_bbox',
         'record_client_events_for_client_invoice', 'record_client_events_for_payment',
         'record_client_events_for_invoice', 'trg_client_invoice_event', 'trg_payment_event',
         'trg_invoice_event', 'houses_coverage', 'eddm_to_metres', 'eddm_rebuild_segments',
         'eddm_materialize_zones', 'eddm_unserved_cells', 'houses_unserved_points',
         'houses_zip_counts', 'eddm_assign_houses', 'ownership_summary', 'house_nearest',
         'relationship_ownership_matrix', 'kind_code', 'marketing_house_number',
         'marketing_street_key', 'summary_keys', 'zone_needs_approval',
         'customer_unsubscribe_token', 'evaluation_sequence_defaults',
         'evaluation_sequence_render', 'evaluation_sequence_effective', 'evaluation_sequence_due',
         'evaluation_sequence_claim', 'evaluation_sequence_sent', 'evaluation_sequence_failed',
         'ensure_evaluation_intake'
       )
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end
$$;

-- Internal only. These read a business's bank, its operations summary and
-- its people's diaries, or are trigger bodies with no reason to be called.
revoke execute on function public.bank_status(uuid) from anon;
revoke execute on function public.ops_pulse(uuid) from anon;
revoke execute on function public.ops_actions_list(uuid, integer) from anon;
revoke execute on function public.summary_compute(uuid, text) from anon;
revoke execute on function public.person_busy_windows(uuid, uuid) from anon;
revoke execute on function public.sync_job_lead() from anon;
revoke execute on function public.sync_job_window() from anon;

-- PostGIS internals nobody calls from a browser.
revoke execute on function public.st_estimatedextent(text, text) from anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text) from anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text, boolean) from anon, authenticated;
