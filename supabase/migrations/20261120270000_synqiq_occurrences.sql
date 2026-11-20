-- Classes scheduled in SynqIQ feed the same class records (class_occurrences)
-- that dashboards, payroll, substitutions, the heat map, ratings, milestones
-- and Follow Up read. A SynqIQ date's record is keyed by its class_session_id
-- (Mindbody's stay keyed by Mindbody's occurrence id); attendance links a
-- booking to its record by that id, or by Mindbody schedule + start as before.
alter table class_occurrences
  add column if not exists class_session_id uuid references class_sessions (id) on delete cascade,
  add column if not exists pay_override_cents integer,
  add column if not exists assistant_staff_id uuid references staff (id) on delete set null,
  add column if not exists assistant_pay_cents integer;
create unique index if not exists class_occurrences_class_session_key on class_occurrences (class_session_id);

create or replace view public.class_visits
with (security_invoker = true)
as
  -- Mindbody's visits (signed in by either system).
  select
    v.id,
    v.organization_id,
    v.occurrence_id,
    v.client_mindbody_unique_id,
    (
      v.signed_in
      or exists (
        select 1
        from class_bookings b
        join class_sessions s on s.id = b.class_session_id
        join clients cl on cl.organization_id = b.organization_id and cl.mindbody_client_id = b.mindbody_client_id
        join class_occurrences o
          on o.organization_id = b.organization_id
          and (
            o.class_session_id = s.id
            or (o.mindbody_class_schedule_id = s.mindbody_class_schedule_id and o.start_datetime = s.starts_at)
          )
        where o.id = v.occurrence_id
          and cl.mindbody_unique_id = v.client_mindbody_unique_id
          and b.status = 'checked_in'
      )
    ) as signed_in,
    v.synced_at
  from class_visits_mindbody v
  union all
  -- SynqIQ bookings Mindbody has no visit for (every booking on a SynqIQ class).
  select
    b.id,
    b.organization_id,
    o.id as occurrence_id,
    cl.mindbody_unique_id as client_mindbody_unique_id,
    b.status = 'checked_in' as signed_in,
    b.updated_at as synced_at
  from class_bookings b
  join class_sessions s on s.id = b.class_session_id
  join class_occurrences o
    on o.organization_id = b.organization_id
    and (
      o.class_session_id = s.id
      or (o.mindbody_class_schedule_id = s.mindbody_class_schedule_id and o.start_datetime = s.starts_at)
    )
  join clients cl on cl.organization_id = b.organization_id and cl.mindbody_client_id = b.mindbody_client_id
  where b.status in ('booked', 'checked_in', 'no_show')
    and not exists (
      select 1
      from class_visits_mindbody v
      where v.organization_id = b.organization_id
        and v.occurrence_id = o.id
        and v.client_mindbody_unique_id = cl.mindbody_unique_id
    );

revoke all on public.class_visits from anon;
grant select on public.class_visits to authenticated, service_role;

create or replace function private.refresh_synqiq_signed_in(p_org uuid, p_session uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  with targets as (
    select o.id as occurrence_id, s.id as session_id
    from class_sessions s
    join class_occurrences o
      on o.organization_id = s.organization_id
      and (
        o.class_session_id = s.id
        or (o.mindbody_class_schedule_id = s.mindbody_class_schedule_id and o.start_datetime = s.starts_at)
      )
    where s.organization_id = p_org
      and (p_session is null or s.id = p_session)
      and (p_session is not null or exists (select 1 from class_bookings b where b.class_session_id = s.id))
  ),
  counts as (
    select
      t.occurrence_id,
      count(b.id) filter (
        where b.status = 'checked_in'
          and not exists (
            select 1
            from class_visits_mindbody v
            where v.occurrence_id = t.occurrence_id
              and v.signed_in
              and v.client_mindbody_unique_id = cl.mindbody_unique_id
          )
      )::integer as n
    from targets t
    left join class_bookings b on b.class_session_id = t.session_id
    left join clients cl on cl.organization_id = b.organization_id and cl.mindbody_client_id = b.mindbody_client_id
    group by t.occurrence_id
  )
  update class_occurrences o
  set synqiq_signed_in = c.n
  from counts c
  where o.id = c.occurrence_id
    and o.synqiq_signed_in is distinct from c.n
$$;

revoke all on function private.refresh_synqiq_signed_in(uuid, uuid) from public, anon, authenticated;
