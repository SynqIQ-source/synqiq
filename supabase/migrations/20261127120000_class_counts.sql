-- Visit counts on the class roster: for each person, how many visits of each
-- kind they had before this class. Categories (The Preserve): Group Fitness,
-- Yoga, Cycle, Group Reformer and Pool (classes, sorted by name with
-- private.class_category, the same rules as lib/classes/visit-categories.ts),
-- PT (appointments) and front-desk check-ins. Their sum is all-time visits,
-- like Mindbody's "Visits": a check-in and a class on the same day are two.
--
-- Sources: Mindbody's visit history (member_visits), the class roster sync
-- (class_visits), SynqIQ class check-ins (class_bookings) and SynqIQ
-- front-desk check-ins (check_ins). The same class from several sources
-- counts once (same member, same start minute). Until the switch staff may
-- check someone in at both desks, so front-desk check-ins per day are the
-- larger of Mindbody's arrivals and SynqIQ's check-ins, not their sum.
--
-- Also tracks the one-time pull of all-time visit history.
alter table public.member_profile_sync add column if not exists all_time_visits_at timestamptz;

create or replace function private.class_category(p_name text)
returns text
language sql
immutable
as $$
  select case
    when n ~ 'pool lane|swim' then 'pool'
    when n ~ 'reformer|pilates heat|small group pilates|intro to pilates|pilates 101' or n = 'pilates' then 'reformer'
    when n ~ 'cycl|ride|r\.i\.d\.e|spin|rpm' then 'cycle'
    when n ~ 'yoga|vinyasa|flow|hatha|yin|restorative|mat fusion|spinal strength|meditation' then 'yoga'
    else 'group_fitness'
  end
  from (select lower(trim(coalesce(p_name, ''))) as n) x
$$;

create or replace function private.visit_counts_before(p_org uuid, p_clients text[], p_before timestamptz)
returns table (
  mindbody_client_id text,
  group_fitness integer,
  yoga integer,
  cycle integer,
  reformer integer,
  pool integer,
  pt integer,
  check_ins integer
)
language sql
stable
security definer
set search_path = public
as $$
  with org as (
    select coalesce(timezone, 'America/Chicago') as tz from organizations where id = p_org
  ),
  class_rows as (
    select v.mindbody_client_id, v.start_local at time zone org.tz as class_start, v.name as class_name
    from member_visits v, org
    where v.organization_id = p_org and v.kind = 'class' and v.signed_in and v.mindbody_client_id = any (p_clients)
    union all
    select cl.mindbody_client_id, o.start_datetime, o.class_name
    from class_visits cv
    join class_occurrences o on o.id = cv.occurrence_id
    join clients cl on cl.organization_id = p_org and cl.mindbody_unique_id = cv.client_mindbody_unique_id
    where cv.organization_id = p_org and cv.signed_in and cl.mindbody_client_id = any (p_clients)
    union all
    select b.mindbody_client_id, s.starts_at, s.class_name
    from class_bookings b
    join class_sessions s on s.id = b.class_session_id
    where b.organization_id = p_org and b.status = 'checked_in' and b.mindbody_client_id = any (p_clients)
  ),
  classes as (
    -- One row per class attended; the category of the first name seen.
    select c.mindbody_client_id, date_trunc('minute', c.class_start) as at, min(private.class_category(c.class_name)) as category
    from class_rows c
    where c.class_start < p_before
    group by 1, 2
  ),
  appointments as (
    select v.mindbody_client_id, count(*)::integer as n
    from member_visits v, org
    where v.organization_id = p_org and v.kind = 'appointment' and v.signed_in and v.mindbody_client_id = any (p_clients)
      and v.start_local at time zone org.tz < p_before
    group by 1
  ),
  arrivals_by_day as (
    select a.mindbody_client_id, a.day, max(a.n) as n
    from (
      select v.mindbody_client_id, v.start_local::date as day, count(*) as n
      from member_visits v, org
      where v.organization_id = p_org and v.kind = 'arrival' and v.signed_in and v.mindbody_client_id = any (p_clients)
        and v.start_local at time zone org.tz < p_before
      group by 1, 2
      union all
      select c.mindbody_client_id, c.local_date, count(*)
      from check_ins c
      where c.organization_id = p_org and c.voided_at is null and c.mindbody_client_id = any (p_clients) and c.checked_in_at < p_before
      group by 1, 2
    ) a
    group by 1, 2
  ),
  arrivals as (
    select mindbody_client_id, sum(n)::integer as n from arrivals_by_day group by 1
  ),
  by_class as (
    select mindbody_client_id,
      count(*) filter (where category = 'group_fitness')::integer as group_fitness,
      count(*) filter (where category = 'yoga')::integer as yoga,
      count(*) filter (where category = 'cycle')::integer as cycle,
      count(*) filter (where category = 'reformer')::integer as reformer,
      count(*) filter (where category = 'pool')::integer as pool
    from classes
    group by 1
  )
  select ids.id,
    coalesce(b.group_fitness, 0), coalesce(b.yoga, 0), coalesce(b.cycle, 0), coalesce(b.reformer, 0), coalesce(b.pool, 0),
    coalesce(ap.n, 0), coalesce(ar.n, 0)
  from unnest(p_clients) as ids(id)
  left join by_class b on b.mindbody_client_id = ids.id
  left join appointments ap on ap.mindbody_client_id = ids.id
  left join arrivals ar on ar.mindbody_client_id = ids.id
$$;

create or replace function public.visit_counts_before(p_org uuid, p_clients text[], p_before timestamptz)
returns table (
  mindbody_client_id text,
  group_fitness integer,
  yoga integer,
  cycle integer,
  reformer integer,
  pool integer,
  pt integer,
  check_ins integer
)
language sql
stable
security definer
set search_path = public
as $$ select * from private.visit_counts_before(p_org, p_clients, p_before) $$;

revoke all on function private.class_category(text) from public, anon, authenticated;
revoke all on function private.visit_counts_before(uuid, text[], timestamptz) from public, anon, authenticated;
revoke all on function public.visit_counts_before(uuid, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.visit_counts_before(uuid, text[], timestamptz) to service_role;
