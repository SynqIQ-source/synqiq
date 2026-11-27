-- Shown on the class roster for each person, before this class:
--   classes: group classes they were checked into (Pilates, The Yard, yoga,
--     cycle...). Pool lanes are counted separately: a pool-lane page counts
--     pool lanes, any other class page counts classes.
--   visits: every visit of any kind, like Mindbody's "Visits": front-desk
--     check-ins, classes (pool lanes included) and appointments (PT). A
--     check-in and a class on the same day are two visits.
-- Sources: Mindbody's visit history (member_visits), the class roster sync
-- (class_visits), SynqIQ class check-ins (class_bookings) and SynqIQ
-- front-desk check-ins (check_ins). The same class from several sources
-- counts once (same member, same start minute). Until the switch staff may
-- check someone in at both desks, so front-desk check-ins per day are the
-- larger of Mindbody's arrivals and SynqIQ's check-ins, not their sum.
-- Also tracks the one-time pull of all-time visit history.
alter table public.member_profile_sync add column if not exists all_time_visits_at timestamptz;

create or replace function private.class_counts_before(p_org uuid, p_clients text[], p_before timestamptz, p_pool boolean)
returns table (mindbody_client_id text, classes integer, visits integer)
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
    select distinct c.mindbody_client_id, date_trunc('minute', c.class_start) as at, (coalesce(c.class_name, '') ~* 'pool lane') as pool
    from class_rows c
    where c.class_start < p_before
  ),
  appointments as (
    select v.mindbody_client_id, count(*)::integer as n
    from member_visits v, org
    where v.organization_id = p_org and v.kind = 'appointment' and v.signed_in and v.mindbody_client_id = any (p_clients)
      and v.start_local at time zone org.tz < p_before
    group by v.mindbody_client_id
  ),
  arrivals_by_day as (
    select a.mindbody_client_id, a.day, max(a.n) as n
    from (
      select v.mindbody_client_id, v.start_local::date as day, count(*) as n, 'mindbody' as src
      from member_visits v, org
      where v.organization_id = p_org and v.kind = 'arrival' and v.signed_in and v.mindbody_client_id = any (p_clients)
        and v.start_local at time zone org.tz < p_before
      group by 1, 2
      union all
      select c.mindbody_client_id, c.local_date, count(*), 'synqiq'
      from check_ins c
      where c.organization_id = p_org and c.voided_at is null and c.mindbody_client_id = any (p_clients) and c.checked_in_at < p_before
      group by 1, 2
    ) a
    group by 1, 2
  ),
  arrivals as (
    select mindbody_client_id, sum(n)::integer as n from arrivals_by_day group by 1
  ),
  ids as (
    select unnest(p_clients) as mindbody_client_id
  )
  select ids.mindbody_client_id,
    (select count(*) from classes c where c.mindbody_client_id = ids.mindbody_client_id and c.pool = p_pool)::integer as classes,
    ((select count(*) from classes c where c.mindbody_client_id = ids.mindbody_client_id)
      + coalesce((select n from appointments a where a.mindbody_client_id = ids.mindbody_client_id), 0)
      + coalesce((select n from arrivals a where a.mindbody_client_id = ids.mindbody_client_id), 0))::integer as visits
  from ids
$$;

create or replace function public.class_counts_before(p_org uuid, p_clients text[], p_before timestamptz, p_pool boolean)
returns table (mindbody_client_id text, classes integer, visits integer)
language sql
stable
security definer
set search_path = public
as $$ select * from private.class_counts_before(p_org, p_clients, p_before, p_pool) $$;

revoke all on function private.class_counts_before(uuid, text[], timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.class_counts_before(uuid, text[], timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.class_counts_before(uuid, text[], timestamptz, boolean) to service_role;
