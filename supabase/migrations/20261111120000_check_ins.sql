-- General (gym) check-ins recorded in SynqIQ, each attributed to what
-- covers the visit: a membership or a pass (Mindbody's "Memberships &
-- Passes" services), or nothing (checked in anyway, with a reason).
-- Until the switch Mindbody still records arrivals; this is SynqIQ's own
-- record for the parallel run. Staff of the studio can read them; the API
-- writes with the service role after checking the role.
create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  client_name text not null,
  checked_in_at timestamptz not null default now(),
  local_date date not null,
  checked_in_by_staff_id uuid references staff (id),
  method text not null default 'front_desk' check (method in ('front_desk', 'kiosk')),
  coverage_kind text not null check (coverage_kind in ('membership', 'pass', 'none')),
  coverage_name text,                 -- e.g. "12 Month Commitment", "7 Day Guest Pass"
  mindbody_client_service_id bigint,  -- the service that covered it
  member_contract_id uuid references member_contracts (id) on delete set null,
  warnings jsonb not null default '[]'::jsonb, -- what staff were shown (frozen, declined, already in today...)
  note text,                          -- required when nothing covers it
  voided_at timestamptz,
  voided_by_staff_id uuid references staff (id),
  void_reason text
);
create index if not exists check_ins_day_idx on check_ins (organization_id, local_date desc);
create index if not exists check_ins_client_idx on check_ins (organization_id, mindbody_client_id, checked_in_at desc);

alter table check_ins enable row level security;
create policy "check_ins_select_same_org" on check_ins for select to authenticated
  using (organization_id = private.current_staff_org_id());
