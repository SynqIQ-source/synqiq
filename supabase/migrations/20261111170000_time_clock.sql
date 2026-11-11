-- L3: staff time clock for payroll. One row per shift (clock in -> clock
-- out). At most one open shift per person. Staff see their own punches;
-- Club Admins see everyone's in their studio. All writes go through the
-- API (service role), and every Club Admin change is kept in
-- time_punch_edits with a reason.

create table if not exists time_punches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  source text not null default 'clock' check (source in ('clock', 'admin')), -- added by a Club Admin = 'admin'
  deleted_at timestamptz, -- removed by a Club Admin (kept for the audit)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);
create unique index if not exists time_punches_one_open_idx on time_punches (staff_id) where clock_out_at is null and deleted_at is null;
create index if not exists time_punches_org_in_idx on time_punches (organization_id, clock_in_at);

create table if not exists time_punch_edits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  punch_id uuid not null references time_punches (id) on delete cascade,
  edited_by_staff_id uuid not null references staff (id),
  action text not null check (action in ('add', 'edit', 'delete')),
  before jsonb,
  after jsonb,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists time_punch_edits_org_idx on time_punch_edits (organization_id, created_at desc);

alter table time_punches enable row level security;
alter table time_punch_edits enable row level security;

create policy "time_punches_select_own_or_admin" on time_punches for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (
      staff_id = (select id from staff where auth_user_id = auth.uid())
      or exists (select 1 from staff where auth_user_id = auth.uid() and role = 'admin')
    )
  );
create policy "time_punch_edits_select_admin" on time_punch_edits for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and exists (select 1 from staff where auth_user_id = auth.uid() and role = 'admin')
  );
