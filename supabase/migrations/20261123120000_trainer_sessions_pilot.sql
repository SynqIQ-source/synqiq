-- Trainer sessions pilot (2026-11-23).
--
-- Builds on trainer_sessions / session_packs / session_pack_uses /
-- payroll_events (20261112200000, 20261120210000). Nothing here writes to
-- Mindbody. Additive: no existing migration is changed.
--
--   1. organizations: the pilot switch (off by default) and what a no-show /
--      late cancel pays the trainer (percent of the normal pay, default 100).
--   2. trainer_sessions: a room, a "no balance" flag, and close_no (how many
--      times the session has been closed out; each close-out's ledger entry
--      and pay line carry it, so retries can't double up).
--   3. session_pack_uses and payroll_events become append-only: a correction
--      adds a reversal row (who, why) instead of voiding. Old voided rows stay.
--   4. pay_periods: open / approved / locked. A locked period's pay lines
--      can't be added, changed or removed; corrections go to the next open one.
--   5. trainer_session_rates: effective-dated pay per trainer and session type.
--   6. session_packs.session_value_cents: what one session of the pack is
--      worth (pre-tax price / sessions), the base for percentage pay.
--   7. session_pack_balances: adds remaining_since_sync (the last Mindbody
--      balance plus SynqIQ entries made after it), used while the pilot runs
--      beside Mindbody.

-- 1. Studio settings ------------------------------------------------------------
alter table organizations add column if not exists trainer_sessions_pilot boolean not null default false;
alter table organizations add column if not exists pt_no_show_pay_percent integer not null default 100
  check (pt_no_show_pay_percent between 0 and 100);
alter table organizations add column if not exists pt_late_cancel_pay_percent integer not null default 100
  check (pt_late_cancel_pay_percent between 0 and 100);

-- 2. Sessions ----------------------------------------------------------------------
alter table trainer_sessions add column if not exists room_id uuid references rooms (id) on delete set null;
alter table trainer_sessions add column if not exists no_balance boolean not null default false;
alter table trainer_sessions add column if not exists close_no integer not null default 0 check (close_no >= 0);
create index if not exists trainer_sessions_room_idx on trainer_sessions (room_id, starts_at) where room_id is not null;
create index if not exists trainer_sessions_client_idx on trainer_sessions (organization_id, mindbody_client_id, starts_at);

-- Sessions already closed out count as their first close-out.
update trainer_sessions set close_no = 1 where status <> 'booked' and close_no = 0;

-- 3a. Session ledger: reversals instead of voids ------------------------------------
alter table session_pack_uses add column if not exists close_no integer;
alter table session_pack_uses add column if not exists reverses_use_id uuid references session_pack_uses (id);
alter table session_pack_uses add column if not exists reason text;

update session_pack_uses set close_no = 1
where trainer_session_id is not null and voided_at is null and close_no is null and sessions < 0;

drop index if exists session_pack_uses_session_key;
-- One charge per session per close-out, and one reversal per charge.
create unique index if not exists session_pack_uses_charge_key on session_pack_uses (trainer_session_id, close_no)
  where trainer_session_id is not null and close_no is not null and reverses_use_id is null;
create unique index if not exists session_pack_uses_reversal_key on session_pack_uses (reverses_use_id)
  where reverses_use_id is not null;

-- 3b. Payroll lines: reversals, periods, rate snapshots -------------------------------
create table if not exists pay_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('open', 'approved', 'locked')),
  approved_at timestamptz,
  approved_by_staff_id uuid references staff (id),
  locked_at timestamptz,
  locked_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (organization_id, starts_on)
);

alter table payroll_events add column if not exists close_no integer;
alter table payroll_events add column if not exists reverses_event_id uuid references payroll_events (id);
alter table payroll_events add column if not exists reason text;
alter table payroll_events add column if not exists pay_period_id uuid references pay_periods (id);
alter table payroll_events add column if not exists session_type_id integer;
alter table payroll_events add column if not exists rate_method text check (rate_method in ('percent', 'flat'));
alter table payroll_events add column if not exists rate_percent_bp integer check (rate_percent_bp between 0 and 10000);
alter table payroll_events add column if not exists rate_flat_cents integer check (rate_flat_cents >= 0);
alter table payroll_events add column if not exists pay_percent integer check (pay_percent between 0 and 100);

update payroll_events set close_no = 1
where trainer_session_id is not null and voided_at is null and close_no is null;

drop index if exists payroll_events_session_live_idx;
create unique index if not exists payroll_events_charge_key on payroll_events (trainer_session_id, close_no)
  where trainer_session_id is not null and close_no is not null and reverses_event_id is null;
create unique index if not exists payroll_events_reversal_key on payroll_events (reverses_event_id)
  where reverses_event_id is not null;
create index if not exists payroll_events_period_idx on payroll_events (pay_period_id);

-- A locked period is final: no pay line in it can be added, changed or removed.
create or replace function private.payroll_events_period_guard() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.pay_period_id is not null
     and exists (select 1 from pay_periods where id = old.pay_period_id and status = 'locked') then
    raise exception 'This pay period is locked. Corrections go into the next open period.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.pay_period_id is not null
     and exists (select 1 from pay_periods where id = new.pay_period_id and status = 'locked') then
    raise exception 'This pay period is locked. Corrections go into the next open period.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists payroll_events_period_guard on payroll_events;
create trigger payroll_events_period_guard before insert or update or delete on payroll_events
  for each row execute function private.payroll_events_period_guard();

-- Once locked, a period can't be reopened or moved.
create or replace function private.pay_periods_lock_guard() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.status = 'locked' then
    raise exception 'A locked pay period can''t be changed.';
  end if;
  return new;
end;
$$;
drop trigger if exists pay_periods_lock_guard on pay_periods;
create trigger pay_periods_lock_guard before update or delete on pay_periods
  for each row execute function private.pay_periods_lock_guard();

-- 5. Effective-dated session rates ----------------------------------------------------
-- One row per change, never edited: the rate on a session's date is the latest
-- row with effective_from on or before it, for that trainer and session type
-- (session_type_id null = the trainer's default for any session type).
create table if not exists trainer_session_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id) on delete cascade,
  session_type_id integer,
  method text not null check (method in ('percent', 'flat')),
  percent_bp integer check (percent_bp between 0 and 10000), -- 6500 = 65.00% of the session's value
  flat_cents integer check (flat_cents >= 0),
  effective_from date not null,
  note text,
  created_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  check ((method = 'percent' and percent_bp is not null) or (method = 'flat' and flat_cents is not null))
);
create unique index if not exists trainer_session_rates_key
  on trainer_session_rates (staff_id, coalesce(session_type_id, -1), effective_from);
create index if not exists trainer_session_rates_org_idx on trainer_session_rates (organization_id, staff_id);

-- 6. What one session of a pack is worth ------------------------------------------------
alter table session_packs add column if not exists session_value_cents integer check (session_value_cents >= 0);

-- 7. Balance since the last Mindbody refresh -------------------------------------------
-- Recreated (not replaced): p.* now includes session_value_cents.
drop view if exists public.session_pack_balances;
create view public.session_pack_balances
with (security_invoker = true)
as
  select
    p.*,
    p.opening_remaining + coalesce((select sum(u.sessions) from session_pack_uses u where u.session_pack_id = p.id and u.voided_at is null), 0)
      as remaining,
    p.opening_remaining + coalesce((
      select sum(u.sessions) from session_pack_uses u
      where u.session_pack_id = p.id and u.voided_at is null
        and (p.refreshed_at is null or u.created_at > p.refreshed_at)
    ), 0) as remaining_since_sync
  from session_packs p;
revoke all on public.session_pack_balances from anon;
grant select on public.session_pack_balances to authenticated, service_role;

-- Row-level security ----------------------------------------------------------------------
-- Reads only; every write goes through the API (service role) after its role checks.
alter table pay_periods enable row level security;
alter table trainer_session_rates enable row level security;

drop policy if exists pay_periods_select_admin on pay_periods;
create policy pay_periods_select_admin on pay_periods for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

drop policy if exists trainer_session_rates_select_admin on trainer_session_rates;
create policy trainer_session_rates_select_admin on trainer_session_rates for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

revoke all on pay_periods, trainer_session_rates from anon;
grant select on pay_periods, trainer_session_rates to authenticated;
grant all on pay_periods, trainer_session_rates to service_role;
revoke all on function private.payroll_events_period_guard() from public, anon, authenticated;
revoke all on function private.pay_periods_lock_guard() from public, anon, authenticated;
