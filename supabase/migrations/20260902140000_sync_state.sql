-- Per-sync run state, one row per (org, sync_name).
--
-- Why this exists: the nightly cron funnelled every MindBody sync through a
-- single /api/sync/all call whose only "already ran today" gate was
-- syncClasses's (keyed off class_occurrences.sync_timestamp). classes runs
-- first, so once it succeeded the gate was satisfied for the whole run --
-- and when the combined call then exceeded the function time limit before
-- appointments/sales/clients/class-visits finished, every later firing saw
-- the gate and returned immediately without retrying them. They silently
-- went stale for a week (Trainer Health, room heat map).
--
-- Each sync now gets its own gate and its own recorded status here, so a
-- partial failure is visible and self-heals on the next firing instead of
-- being masked by classes succeeding.

begin;

create table sync_state (
  organization_id uuid not null references organizations (id) on delete cascade,
  sync_name text not null,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_status text check (last_status in ('running', 'success', 'error')),
  last_error text,
  last_result jsonb,
  primary key (organization_id, sync_name)
);

alter table sync_state enable row level security;

-- Read-only, same-org, admin only -- this is operational status an admin
-- might surface on a settings/status page later. All writes are
-- service-role (the sync jobs), which bypasses RLS.
create policy "sync_state_select_same_org_admin"
  on sync_state for select
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and exists (
      select 1 from staff
      where staff.auth_user_id = auth.uid()
        and staff.organization_id = sync_state.organization_id
        and staff.role = 'admin'
    )
  );

commit;
