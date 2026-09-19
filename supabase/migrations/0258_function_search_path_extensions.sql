-- The hardened functions need the extensions schema too.
--
-- 0255 pinned every function's search_path to public. pgcrypto lives in
-- the extensions schema, so customer_unsubscribe_token(), which mints a
-- token with gen_random_bytes on every new customer, stopped resolving it,
-- and inserting a customer failed, which is to say booking failed. Same
-- pin, one schema wider.

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
         'ensure_evaluation_intake', 'person_busy_windows'
       )
  loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end
$$;
