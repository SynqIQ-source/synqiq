-- Unified attendance (Dec 10 transition): from Dec 10 staff check members in
-- with SynqIQ, which Mindbody never hears about, so every report that counts
-- attendance (class dashboard, heat map, follow-up, ratings, milestones,
-- payroll) must see SynqIQ check-ins too, each class counted once.
--
-- 1. The Mindbody visit rows move to class_visits_mindbody (the class-visits
--    sync writes there). class_visits becomes a view of those rows plus
--    SynqIQ bookings Mindbody doesn't have, so every reader keeps working
--    unchanged. A Mindbody visit counts as signed in when either system says so.
-- 2. class_occurrences.synqiq_signed_in: check-ins done only in SynqIQ, added
--    to Mindbody's total_signed_in by the readers that use totals.

alter table class_visits rename to class_visits_mindbody;

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
          and o.mindbody_class_schedule_id = s.mindbody_class_schedule_id
          and o.start_datetime = s.starts_at
        where o.id = v.occurrence_id
          and cl.mindbody_unique_id = v.client_mindbody_unique_id
          and b.status = 'checked_in'
      )
    ) as signed_in,
    v.synced_at
  from class_visits_mindbody v
  union all
  -- SynqIQ bookings Mindbody has no visit for.
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
    and o.mindbody_class_schedule_id = s.mindbody_class_schedule_id
    and o.start_datetime = s.starts_at
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

-- Check-ins done only in SynqIQ, per Mindbody class (kept current by the
-- trigger below and after each visits sync).
alter table class_occurrences add column if not exists synqiq_signed_in integer not null default 0;

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
      and o.mindbody_class_schedule_id = s.mindbody_class_schedule_id
      and o.start_datetime = s.starts_at
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

create or replace function public.refresh_synqiq_signed_in(p_org uuid)
returns void
language sql
security definer
set search_path = public
as $$ select private.refresh_synqiq_signed_in(p_org, null) $$;
revoke all on function public.refresh_synqiq_signed_in(uuid) from public, anon, authenticated;
grant execute on function public.refresh_synqiq_signed_in(uuid) to service_role;

create or replace function private.booking_signed_in_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.refresh_synqiq_signed_in(coalesce(new.organization_id, old.organization_id), coalesce(new.class_session_id, old.class_session_id));
  return null;
end;
$$;

drop trigger if exists class_bookings_signed_in_changed on class_bookings;
create trigger class_bookings_signed_in_changed
  after insert or delete or update of status on class_bookings
  for each row execute function private.booking_signed_in_changed();
