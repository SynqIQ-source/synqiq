-- ============================================================================
-- Permissions for the LOCAL test database. Never run this against the hosted
-- project.
--
-- The baseline export (schema.sql) was taken with --no-privileges, so it has
-- no GRANT/REVOKE lines. These are rebuilt from the migrations instead: every
-- grant/revoke statement in supabase/migrations/ up to the cutoff
-- (20261120290000), in the same order, copied verbatim. Each one is wrapped
-- so that a statement about an object a later migration dropped is skipped
-- (with a notice) instead of stopping the load.
--
-- Some of these matter to the tests, e.g. staff can't call
-- allocate_member_id and anon can't call crm_rate_limit_hit.
-- 48 statements.
-- ============================================================================

-- 20260718205354_enable_rls_substitution_workflow_tables.sql
do $do$ begin
  execute $sql$revoke all on function private.current_staff_id() from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.current_staff_id() from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function private.current_staff_org_id() from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.current_staff_org_id() from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function private.current_staff_role() from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.current_staff_role() from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function private.staff_org_id(uuid) from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.staff_org_id(uuid) from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.current_staff_id() to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.current_staff_id() to authenticated;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.current_staff_org_id() to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.current_staff_org_id() to authenticated;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.current_staff_role() to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.current_staff_role() to authenticated;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.staff_org_id(uuid) to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.staff_org_id(uuid) to authenticated;$sql$;
end $do$;

-- 20260719232838_message_boards.sql
do $do$ begin
  execute $sql$revoke all on function private.can_access_board(uuid) from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.can_access_board(uuid) from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.can_access_board(uuid) to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.can_access_board(uuid) to authenticated;$sql$;
end $do$;

-- 20260720150000_supersede_substitution_request_rpc.sql
do $do$ begin
  execute $sql$revoke all on function public.supersede_substitution_request(uuid, text) from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function public.supersede_substitution_request(uuid, text) from pu$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function public.supersede_substitution_request(uuid, text) to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function public.supersede_substitution_request(uuid, text) to a$sql$;
end $do$;

-- 20261028120000_crm_phase1.sql
do $do$ begin
  execute $sql$revoke all on function public.crm_rate_limit_hit(text, integer, integer) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function public.crm_rate_limit_hit(text, integer, integer) from pu$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function public.crm_rate_limit_hit(text, integer, integer) to service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function public.crm_rate_limit_hit(text, integer, integer) to s$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function private.current_staff_can_sell() from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.current_staff_can_sell() from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function private.can_read_crm(uuid) from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.can_read_crm(uuid) from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.current_staff_can_sell() to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.current_staff_can_sell() to authenticated;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.can_read_crm(uuid) to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.can_read_crm(uuid) to authenticated;$sql$;
end $do$;

-- 20261115220000_team_boards.sql
do $do$ begin
  execute $sql$revoke all on function private.current_staff_on_sales_team() from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.current_staff_on_sales_team() from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function private.current_staff_is_trainer() from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.current_staff_is_trainer() from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.current_staff_on_sales_team() to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.current_staff_on_sales_team() to authenticated$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.current_staff_is_trainer() to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.current_staff_is_trainer() to authenticated;$sql$;
end $do$;

-- 20261118210000_members_for_sales.sql
do $do$ begin
  execute $sql$revoke all on function private.current_staff_sees_members() from public, anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.current_staff_sees_members() from public, anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.current_staff_sees_members() to authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.current_staff_sees_members() to authenticated;$sql$;
end $do$;

-- 20261119210000_member_ids.sql
do $do$ begin
  execute $sql$revoke all on function private.allocate_member_id(uuid) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.allocate_member_id(uuid) from public, anon, authe$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function private.allocate_member_id(uuid) to service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function private.allocate_member_id(uuid) to service_role;$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function public.allocate_member_id(uuid) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function public.allocate_member_id(uuid) from public, anon, authen$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function public.allocate_member_id(uuid) to service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function public.allocate_member_id(uuid) to service_role;$sql$;
end $do$;

-- 20261120130000_newsletters.sql
do $do$ begin
  execute $sql$revoke all on function private.newsletter_audience(uuid, jsonb) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.newsletter_audience(uuid, jsonb) from public, ano$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function public.newsletter_audience(uuid, jsonb) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function public.newsletter_audience(uuid, jsonb) from public, anon$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function public.newsletter_audience(uuid, jsonb) to service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function public.newsletter_audience(uuid, jsonb) to service_rol$sql$;
end $do$;

-- 20261120140000_member_email_optin.sql
do $do$ begin
  execute $sql$revoke all on function private.newsletter_audience(uuid, jsonb) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.newsletter_audience(uuid, jsonb) from public, ano$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function public.newsletter_audience(uuid, jsonb) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function public.newsletter_audience(uuid, jsonb) from public, anon$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function public.newsletter_audience(uuid, jsonb) to service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function public.newsletter_audience(uuid, jsonb) to service_rol$sql$;
end $do$;

-- 20261120150000_milestone_emails.sql
do $do$ begin
  execute $sql$revoke all on function private.class_milestones(uuid, timestamptz) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.class_milestones(uuid, timestamptz) from public, $sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function public.class_milestones(uuid, timestamptz) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function public.class_milestones(uuid, timestamptz) from public, a$sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function public.class_milestones(uuid, timestamptz) to service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function public.class_milestones(uuid, timestamptz) to service_$sql$;
end $do$;

-- 20261120200000_unified_attendance.sql
do $do$ begin
  execute $sql$revoke all on public.class_visits from anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on public.class_visits from anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant select on public.class_visits to authenticated, service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant select on public.class_visits to authenticated, service_role;$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function private.refresh_synqiq_signed_in(uuid, uuid) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.refresh_synqiq_signed_in(uuid, uuid) from public,$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function public.refresh_synqiq_signed_in(uuid) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function public.refresh_synqiq_signed_in(uuid) from public, anon, $sql$;
end $do$;
do $do$ begin
  execute $sql$grant execute on function public.refresh_synqiq_signed_in(uuid) to service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function public.refresh_synqiq_signed_in(uuid) to service_role;$sql$;
end $do$;

-- 20261120210000_session_packs.sql
do $do$ begin
  execute $sql$revoke all on public.session_pack_balances from anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on public.session_pack_balances from anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant select on public.session_pack_balances to authenticated, service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant select on public.session_pack_balances to authenticated, service_role;$sql$;
end $do$;

-- 20261120270000_synqiq_occurrences.sql
do $do$ begin
  execute $sql$revoke all on public.class_visits from anon$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on public.class_visits from anon;$sql$;
end $do$;
do $do$ begin
  execute $sql$grant select on public.class_visits to authenticated, service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant select on public.class_visits to authenticated, service_role;$sql$;
end $do$;
do $do$ begin
  execute $sql$revoke all on function private.refresh_synqiq_signed_in(uuid, uuid) from public, anon, authenticated$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$revoke all on function private.refresh_synqiq_signed_in(uuid, uuid) from public,$sql$;
end $do$;

-- 20261120290000_class_visits_occurrence_link.sql
do $do$ begin
  execute $sql$grant execute on function public.class_occurrences(public.class_visits) to authenticated, service_role$sql$;
exception when undefined_function or undefined_table or undefined_object or undefined_column then
  raise notice 'skipped (object no longer exists): %', $sql$grant execute on function public.class_occurrences(public.class_visits) to authe$sql$;
end $do$;
