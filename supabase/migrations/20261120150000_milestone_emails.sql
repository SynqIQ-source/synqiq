-- Admin > Email > Milestones (Adam, 2026-11-19): each instructor writes their
-- own email for a member's 1st, 3rd, 10th, 25th, 50th and 100th class (total,
-- at the studio) and every 100 after that. When a member reaches one in that
-- instructor's class, the email waits for the instructor to approve (or edit)
-- it; Club Admins can edit, turn off or approve any of them.
create table if not exists milestone_templates (
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id) on delete cascade,
  milestone integer not null check (milestone in (1, 3, 10, 25, 50, 100, 200)), -- 200 = every 100 after 100
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 5000),
  enabled boolean not null default false,
  disabled_by_admin boolean not null default false,
  updated_by_staff_id uuid references staff (id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, staff_id, milestone)
);

create table if not exists milestone_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id) on delete cascade,
  mindbody_client_id text not null,
  client_name text,
  class_count integer not null check (class_count > 0),
  class_name text,
  class_start timestamptz not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'expired', 'failed')),
  decided_by_staff_id uuid references staff (id),
  decided_at timestamptz,
  sent_to text,
  created_at timestamptz not null default now(),
  unique (organization_id, mindbody_client_id, class_count)
);
create index if not exists milestone_emails_staff_idx on milestone_emails (organization_id, staff_id, status, created_at desc);

alter table milestone_templates enable row level security;
alter table milestone_emails enable row level security;
-- Read: the instructor's own, or any for Club Admins. Writes go through the server.
drop policy if exists milestone_templates_select on milestone_templates;
create policy milestone_templates_select on milestone_templates for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or staff_id = (select id from staff where auth_user_id = auth.uid() limit 1))
  );
drop policy if exists milestone_emails_select on milestone_emails;
create policy milestone_emails_select on milestone_emails for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or staff_id = (select id from staff where auth_user_id = auth.uid() limit 1))
  );

-- Class milestones reached in classes that started on/after p_since:
-- every signed-in class a member has taken (Mindbody visit history plus the
-- class roster sync, the same class counted once; pool lanes not counted),
-- numbered in order; rows where that number is a milestone, with the
-- instructor who taught that class.
create or replace function private.class_milestones(p_org uuid, p_since timestamptz)
returns table (mindbody_client_id text, staff_id uuid, class_name text, class_start timestamptz, class_count integer)
language sql
stable
security definer
set search_path = public
as $$
  with visits as (
    -- start_local is the studio's wall-clock time.
    select v.mindbody_client_id, v.start_local at time zone coalesce(org.timezone, 'America/Chicago') as class_start, v.name as class_name, s.id as staff_id
    from member_visits v
    join organizations org on org.id = p_org
    left join staff s on s.organization_id = p_org and s.mindbody_staff_id::text = v.staff_mindbody_id::text
    where v.organization_id = p_org and v.kind = 'class' and v.signed_in and v.mindbody_client_id is not null
      and coalesce(v.name, '') !~* 'pool lane'
    union all
    select cl.mindbody_client_id, o.start_datetime, o.class_name, coalesce(o.substitute_staff_id, o.staff_id)
    from class_visits cv
    join class_occurrences o on o.id = cv.occurrence_id
    join clients cl on cl.organization_id = p_org and cl.mindbody_unique_id = cv.client_mindbody_unique_id
    where cv.organization_id = p_org and cv.signed_in and cl.mindbody_client_id is not null
      and coalesce(o.class_name, '') !~* 'pool lane'
  ),
  one_per_class as (
    -- The same class from both sources: same member, same start minute.
    select distinct on (mindbody_client_id, date_trunc('minute', class_start))
      mindbody_client_id, class_start, class_name, staff_id
    from visits
    order by mindbody_client_id, date_trunc('minute', class_start), staff_id nulls last
  ),
  numbered as (
    select *, row_number() over (partition by mindbody_client_id order by class_start)::integer as class_count
    from one_per_class
  )
  select n.mindbody_client_id, n.staff_id, n.class_name, n.class_start, n.class_count
  from numbered n
  where n.class_start >= p_since
    and n.staff_id is not null
    and (n.class_count in (1, 3, 10, 25, 50, 100) or (n.class_count > 100 and n.class_count % 100 = 0))
$$;

create or replace function public.class_milestones(p_org uuid, p_since timestamptz)
returns table (mindbody_client_id text, staff_id uuid, class_name text, class_start timestamptz, class_count integer)
language sql
stable
security definer
set search_path = public
as $$ select * from private.class_milestones(p_org, p_since) $$;

revoke all on function private.class_milestones(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.class_milestones(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.class_milestones(uuid, timestamptz) to service_role;
