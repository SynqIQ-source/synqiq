-- Fitness Dashboard goals: the club's monthly personal-training goals
-- (sessions serviced and PT sales). Club Admins set them on the Fitness
-- Dashboard; a month with no goals of its own uses the latest earlier
-- month's, so goals carry forward until someone changes them.

create table if not exists fitness_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  sessions_goal integer check (sessions_goal is null or sessions_goal between 0 and 100000),
  sales_goal_cents bigint check (sales_goal_cents is null or sales_goal_cents between 0 and 100000000000),
  updated_by_staff_id uuid references staff (id),
  updated_at timestamptz not null default now(),
  unique (organization_id, month)
);

-- Club Admins of the studio read them; writes go through the server.
alter table fitness_goals enable row level security;
drop policy if exists "fitness_goals_select_admin" on fitness_goals;
create policy "fitness_goals_select_admin" on fitness_goals for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
