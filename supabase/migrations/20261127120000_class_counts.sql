-- How many classes each member has taken before a given class: shown on the
-- class roster as "12th class" (Mindbody shows the same). Counts every
-- signed-in class from Mindbody's visit history, the class roster sync and
-- SynqIQ check-ins, the same class counted once (same member, same start
-- minute). Pool lanes are counted separately from classes: a pool-lane page
-- counts pool lanes, any other class page counts classes.
create or replace function private.class_counts_before(p_org uuid, p_clients text[], p_before timestamptz, p_pool boolean)
returns table (mindbody_client_id text, classes integer)
language sql
stable
security definer
set search_path = public
as $$
  with visits as (
    select v.mindbody_client_id, v.start_local at time zone coalesce(org.timezone, 'America/Chicago') as class_start, v.name as class_name
    from member_visits v
    join organizations org on org.id = p_org
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
  )
  select mindbody_client_id, count(distinct date_trunc('minute', class_start))::integer
  from visits
  where class_start < p_before
    and (coalesce(class_name, '') ~* 'pool lane') = p_pool
  group by mindbody_client_id
$$;

create or replace function public.class_counts_before(p_org uuid, p_clients text[], p_before timestamptz, p_pool boolean)
returns table (mindbody_client_id text, classes integer)
language sql
stable
security definer
set search_path = public
as $$ select * from private.class_counts_before(p_org, p_clients, p_before, p_pool) $$;

revoke all on function private.class_counts_before(uuid, text[], timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.class_counts_before(uuid, text[], timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.class_counts_before(uuid, text[], timestamptz, boolean) to service_role;
