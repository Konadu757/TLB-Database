select
  to_regclass('tlb.activity_events') as activity_table,
  (select count(*)::int from tlb.activity_events) as activity_count,
  to_regprocedure('public.record_portal_login(text, text)') as record_portal_login,
  to_regprocedure('public.list_activity_events(integer)') as list_activity_events;
