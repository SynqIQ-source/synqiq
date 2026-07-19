-- Maps each org's own department names (Mindbody has no stable, universal
-- "service category" field -- Program.ScheduleType is coarse (Class/
-- Appointment/Session), and departments.mindbody_service_category_id
-- (Mindbody's real Category concept) is null on every class in this data,
-- per the investigation documented in
-- 20260713140000_staff_departments_rooms_mindbody_linkage.sql) to a small,
-- fixed set of canonical categories for the Overview page redesign. An
-- allowlist, not a blocklist: a department simply absent here (e.g. "Class
-- Fees", or any of this sandbox's other 8 departments) never appears in any
-- category section -- no special-case exclusion logic needed anywhere else.
--
-- Deliberately a DB table, not a hardcoded name-match in the frontend: this
-- app is meant to be sold to other clubs, each with their own department
-- names for the same real-world categories. Onboarding a new club means
-- filling in this table, not a code deploy.

begin;

create table department_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  department_id uuid not null references departments (id),
  category text not null check (category in ('pilates', 'group_fitness', 'yoga', 'cycle', 'pool_lanes')),
  created_at timestamptz not null default now(),
  -- Each department maps to at most one category; multiple departments can
  -- roll up into the same category (e.g. future "Reformer 1"/"Reformer 2"
  -- both -> pilates), so this is not also unique on (organization_id, category).
  unique (organization_id, department_id)
);

alter table department_categories enable row level security;

create policy "department_categories_select_same_org"
  on department_categories for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

-- Name-driven, not ID-driven: only inserts a row for whichever of these
-- department names actually exist for this org. In this sandbox that's
-- "Yoga" alone today -- the other 4 names belong to a real club's expected
-- department setup and will start matching once that club's departments
-- sync. Safe to re-run.
insert into department_categories (organization_id, department_id, category)
select (select id from organizations limit 1), d.id, v.category
from departments d
join (
  values
    ('Group Reformer', 'pilates'),
    ('Membership GX Classes', 'group_fitness'),
    ('Yoga', 'yoga'),
    ('Cycling', 'cycle'),
    ('Pool Lanes', 'pool_lanes')
) as v (name, category) on d.name = v.name
on conflict (organization_id, department_id) do nothing;

commit;
