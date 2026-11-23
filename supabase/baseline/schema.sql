-- ============================================================================
-- Baseline schema for the LOCAL test database. Never run this against the
-- hosted project.
--
-- What this is: the structure (tables, views, functions, triggers, RLS
-- policies) of the `public` and `private` schemas, exported from production
-- on 2026-11-23 with
--   pg_dump --schema-only --schema=public --schema=private --no-owner --no-privileges
-- It contains no rows of data, no owners and no GRANT/REVOKE lines.
--
-- Migration cutoff: 20261120290000 (class_visits_occurrence_link).
-- Production has no supabase_migrations.schema_migrations table (migrations
-- were applied by hand in the SQL editor), so the cutoff was derived from
-- this export: every object created by all 136 migrations up to
-- 20261120290000 is present, and the few that are absent were dropped by a
-- later migration. `npm run test:db:setup` loads this file, then
-- storage.sql, then privileges.sql, then only migrations NEWER than the
-- cutoff, then the fake seed.
--
-- Edits made to the raw pg_dump output (nothing else was changed):
--   - removed the `\restrict` / `\unrestrict` lines (a random per-export
--     token that psql older than 17.6 can't read);
--   - CREATE SCHEMA public / private  ->  CREATE SCHEMA IF NOT EXISTS
--     (the local stack already has `public`);
--   - commented out COMMENT ON SCHEMA public (local `postgres` doesn't own it).
--
-- To refresh: re-export the same way, re-apply these three edits, and move
-- the cutoff in scripts/setup-test-db.mjs to the newest migration included.
-- ============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

-- COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: allocate_member_id(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.allocate_member_id(org uuid) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  candidate bigint;
  floor_value bigint;
begin
  select greatest(coalesce(max(mindbody_unique_id), 0) + 1, 100000001) into floor_value
    from clients where organization_id = org and mindbody_unique_id < 1000000000;
  insert into member_id_counters (organization_id, next_value) values (org, floor_value)
    on conflict (organization_id) do nothing;
  select next_value into candidate from member_id_counters where organization_id = org for update;
  candidate := greatest(candidate, floor_value);
  loop
    exit when not exists (
      select 1 from clients
      where organization_id = org and (mindbody_unique_id = candidate or mindbody_client_id = candidate::text)
    );
    candidate := candidate + 1;
  end loop;
  update member_id_counters set next_value = candidate + 1, updated_at = now() where organization_id = org;
  return candidate;
end $$;


--
-- Name: booking_signed_in_changed(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.booking_signed_in_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform private.refresh_synqiq_signed_in(coalesce(new.organization_id, old.organization_id), coalesce(new.class_session_id, old.class_session_id));
  return null;
end;
$$;


--
-- Name: can_access_board(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_access_board(target_board_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from message_boards mb
    where mb.id = target_board_id
      and mb.organization_id = private.current_staff_org_id()
      and (
        mb.board_type = 'announcements'
        or private.current_staff_role() = 'admin'
        or (mb.board_type = 'team_sales' and private.current_staff_on_sales_team())
        or (mb.board_type = 'team_trainers' and private.current_staff_is_trainer())
        or exists (
          select 1 from board_members bm
          where bm.board_id = mb.id
            and bm.staff_id = private.current_staff_id()
            and bm.removed_at is null
        )
      )
  );
$$;


--
-- Name: can_read_crm(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_read_crm(target_org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select target_org = private.current_staff_org_id()
    and (private.current_staff_role() in ('admin', 'sales_lead') or private.current_staff_can_sell());
$$;


--
-- Name: class_milestones(uuid, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.class_milestones(p_org uuid, p_since timestamp with time zone) RETURNS TABLE(mindbody_client_id text, staff_id uuid, class_name text, class_start timestamp with time zone, class_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: create_announcements_board_for_org(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.create_announcements_board_for_org() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into message_boards (organization_id, board_type, title)
  values (new.id, 'announcements', 'Announcements')
  on conflict (organization_id) where board_type = 'announcements' do nothing;

  return new;
end;
$$;


--
-- Name: create_department_board_on_first_occurrence(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.create_department_board_on_first_occurrence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into message_boards (organization_id, board_type, title, department_id)
  select
    coalesce(new.organization_id, (select id from organizations limit 1)),
    'group_department',
    d.name,
    new.department_id
  from departments d
  where d.id = new.department_id
  on conflict (department_id) do nothing;

  return new;
end;
$$;


--
-- Name: create_team_boards_for_org(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.create_team_boards_for_org() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into message_boards (organization_id, board_type, title) values (new.id, 'team_sales', 'Sales Team') on conflict do nothing;
  insert into message_boards (organization_id, board_type, title) values (new.id, 'team_trainers', 'Trainers') on conflict do nothing;
  return new;
end;
$$;


--
-- Name: crm_messages_immutable(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.crm_messages_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.body is distinct from old.body
     or new.subject is distinct from old.subject
     or new.channel is distinct from old.channel
     or new.direction is distinct from old.direction
     or new.contact_id is distinct from old.contact_id
     or new.organization_id is distinct from old.organization_id
     or new.sent_by_staff_id is distinct from old.sent_by_staff_id
     or new.from_address is distinct from old.from_address
     or new.created_at is distinct from old.created_at then
    raise exception 'Messages cannot be changed';
  end if;
  return new;
end;
$$;


--
-- Name: crm_notes_immutable(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.crm_notes_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'Notes cannot be changed; add a new note instead';
end;
$$;


--
-- Name: current_staff_can_sell(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_staff_can_sell() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((select can_sell from staff where auth_user_id = auth.uid()), false);
$$;


--
-- Name: current_staff_id(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_staff_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id from staff where auth_user_id = auth.uid();
$$;


--
-- Name: current_staff_is_trainer(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_staff_is_trainer() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((select role = 'admin' or is_trainer from staff where auth_user_id = auth.uid() and archived_at is null), false);
$$;


--
-- Name: current_staff_on_sales_team(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_staff_on_sales_team() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((select role in ('admin', 'sales_lead', 'sales') or can_sell from staff where auth_user_id = auth.uid() and archived_at is null), false);
$$;


--
-- Name: current_staff_org_id(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_staff_org_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select organization_id from staff where auth_user_id = auth.uid();
$$;


--
-- Name: current_staff_role(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_staff_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role from staff where auth_user_id = auth.uid();
$$;


--
-- Name: current_staff_sees_members(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_staff_sees_members() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(private.current_staff_role() in ('admin', 'sales_lead', 'sales'), false)
$$;


--
-- Name: is_assigned_trainer(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_assigned_trainer(target_contact uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from crm_contacts c
    left join crm_contacts parent on parent.id = c.merged_into_id
    where c.id = target_contact
      and c.organization_id = private.current_staff_org_id()
      and (c.trainer_staff_id = private.current_staff_id() or parent.trainer_staff_id = private.current_staff_id())
  );
$$;


--
-- Name: mark_booking_for_mindbody(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.mark_booking_for_mindbody() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.mindbody_sync_status := 'pending';
    new.mindbody_sync_attempts := 0;
    new.mindbody_sync_error := null;
  end if;
  return new;
end;
$$;


--
-- Name: newsletter_audience(uuid, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.newsletter_audience(p_org uuid, p_filters jsonb) RETURNS TABLE(contact_id uuid, client_id uuid, email text, first_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  with params as (
    select
      coalesce(array(select jsonb_array_elements_text(p_filters -> 'types')), '{}') as types,
      coalesce(array(select jsonb_array_elements_text(p_filters -> 'member_status')), '{}') as member_status,
      coalesce(array(select jsonb_array_elements_text(p_filters -> 'sources')), '{}') as sources,
      nullif(p_filters ->> 'created_from', '')::date as created_from,
      nullif(p_filters ->> 'created_to', '')::date as created_to,
      nullif(p_filters ->> 'visited_from', '')::date as visited_from,
      nullif(p_filters ->> 'visited_to', '')::date as visited_to,
      nullif(p_filters ->> 'not_visited_days', '')::integer as not_visited_days
  ),
  crm as (
    select c.id as contact_id, null::uuid as client_id, c.email, lower(trim(c.email)) as email_key, c.first_name, c.status,
      c.source, c.created_at::date as created_on, c.mindbody_client_id, 1 as priority
    from crm_contacts c
    where c.organization_id = p_org
      and c.deleted_at is null
      and c.merged_into_id is null
      and c.email_consent
      and nullif(trim(c.email), '') is not null
      and c.status in ('lead', 'guest', 'member')
  ),
  mb as (
    select null::uuid as contact_id, cl.id as client_id, x.email, lower(trim(x.email)) as email_key, cl.first_name,
      'member'::text as status, null::text as source, cl.creation_date::date as created_on, cl.mindbody_client_id, 2 as priority
    from clients cl
    left join member_personal mp on mp.organization_id = p_org and mp.mindbody_client_id = cl.mindbody_client_id
    cross join lateral (
      select case when mp.edits ? 'email' then mp.edits ->> 'email' else cl.email end as email
    ) x
    where cl.organization_id = p_org
      and cl.email_promotions
      and coalesce(cl.status, 'Non-Member') <> 'Non-Member'
      and cl.mindbody_client_id is not null
      and nullif(trim(x.email), '') is not null
      and not exists (
        select 1 from crm_contacts c
        where c.organization_id = p_org and c.mindbody_client_id = cl.mindbody_client_id and c.deleted_at is null and c.merged_into_id is null
      )
  ),
  people as (
    select * from crm
    union all
    select * from mb
  ),
  enriched as (
    select
      p.*,
      case
        when p.status <> 'member' then null
        when exists (
          select 1 from member_billing_schedules s
          where s.organization_id = p_org and s.mindbody_client_id = p.mindbody_client_id and s.billing_state in ('past_due', 'frozen')
        ) then 'frozen'
        when cl.status = 'Suspended' then 'frozen'
        when cl.status = 'Active' then 'active'
        else 'cancelled'
      end as member_status,
      greatest(
        (select max(v.start_local) from member_visits v
          where v.organization_id = p_org and v.mindbody_client_id = p.mindbody_client_id and v.signed_in and p.mindbody_client_id is not null)::date,
        (select max(g.visit_at) from guest_visits g where g.organization_id = p_org and g.contact_id = p.contact_id)::date,
        (select max(ci.checked_in_at) from check_ins ci
          where ci.organization_id = p_org and ci.mindbody_client_id = p.mindbody_client_id and ci.voided_at is null and p.mindbody_client_id is not null)::date
      ) as last_visit
    from people p
    left join clients cl on cl.organization_id = p_org and cl.mindbody_client_id = p.mindbody_client_id
    where p.email_key ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      and not exists (select 1 from email_unsubscribes u where u.organization_id = p_org and u.email_normalized = p.email_key)
  )
  select distinct on (e.email_key) e.contact_id, e.client_id, e.email, e.first_name
  from enriched e, params p
  where (cardinality(p.types) = 0 or e.status = any (p.types))
    and (cardinality(p.member_status) = 0 or e.status <> 'member' or e.member_status = any (p.member_status))
    and (cardinality(p.sources) = 0 or e.source = any (p.sources))
    and (p.created_from is null or e.created_on >= p.created_from)
    and (p.created_to is null or e.created_on <= p.created_to)
    and (p.visited_from is null or e.last_visit >= p.visited_from)
    and (p.visited_to is null or e.last_visit <= p.visited_to)
    and (p.not_visited_days is null or e.last_visit is null or e.last_visit < current_date - p.not_visited_days)
  order by e.email_key, e.priority
$_$;


--
-- Name: prevent_board_members_hard_delete(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prevent_board_members_hard_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'board_members rows must be soft-deleted via removed_at, not DELETEd -- hard deletes bypass Realtime''s RLS filtering on DELETE events';
end;
$$;


--
-- Name: prevent_delete(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prevent_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception '% rows are kept indefinitely and cannot be deleted', tg_table_name;
end;
$$;


--
-- Name: refresh_synqiq_signed_in(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_synqiq_signed_in(p_org uuid, p_session uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: staff_org_id(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_org_id(target_staff_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select organization_id from staff where id = target_staff_id;
$$;


--
-- Name: sync_department_board_membership(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sync_department_board_membership() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  target_board_id uuid;
begin
  if (tg_op = 'DELETE') then
    select id into target_board_id from message_boards
      where department_id = old.department_id and board_type = 'group_department';

    if target_board_id is not null then
      update board_members set removed_at = now()
        where board_id = target_board_id and staff_id = old.staff_id and removed_at is null;
    end if;

    return old;
  end if;

  -- Assumes staff_id/department_id don't change on UPDATE -- the app only
  -- ever toggles `enabled` on an existing (staff, department, class_name)
  -- row, never reassigns the row to a different staff member or department.
  select id into target_board_id from message_boards
    where department_id = new.department_id and board_type = 'group_department';

  if target_board_id is null then
    -- No board for this department -- e.g. it has zero real
    -- class_occurrences and was therefore never auto-created. Nothing to
    -- sync.
    return new;
  end if;

  if new.enabled then
    insert into board_members (board_id, staff_id)
      values (target_board_id, new.staff_id)
      on conflict (board_id, staff_id) do update set removed_at = null;
  else
    update board_members set removed_at = now()
      where board_id = target_board_id and staff_id = new.staff_id and removed_at is null;
  end if;

  return new;
end;
$$;


--
-- Name: waiver_signatures_immutable(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.waiver_signatures_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'Signed waivers cannot be changed';
end;
$$;


--
-- Name: waiver_templates_immutable(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.waiver_templates_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.body is distinct from old.body
     or new.body_sha256 is distinct from old.body_sha256
     or new.version is distinct from old.version
     or new.organization_id is distinct from old.organization_id
     or new.published_at is distinct from old.published_at then
    raise exception 'A published waiver version cannot be changed; publish a new version instead';
  end if;
  return new;
end;
$$;


--
-- Name: allocate_member_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_member_id(org uuid) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select private.allocate_member_id(org) $$;


--
-- Name: class_milestones(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.class_milestones(p_org uuid, p_since timestamp with time zone) RETURNS TABLE(mindbody_client_id text, staff_id uuid, class_name text, class_start timestamp with time zone, class_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select * from private.class_milestones(p_org, p_since) $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: class_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    class_session_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    client_name text NOT NULL,
    status text NOT NULL,
    waitlisted_at timestamp with time zone,
    coverage_kind text NOT NULL,
    coverage_name text,
    mindbody_client_service_id bigint,
    note text,
    late_cancel_fee_cents integer,
    booked_at timestamp with time zone DEFAULT now() NOT NULL,
    booked_by_staff_id uuid,
    cancelled_at timestamp with time zone,
    cancelled_by_staff_id uuid,
    cancel_reason text,
    checked_in_at timestamp with time zone,
    checked_in_by_staff_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    booked_by_member_account_id uuid,
    cancelled_by_member_account_id uuid,
    spot_id text,
    spot_label text,
    no_show_fee_cents integer,
    mindbody_sync_status text,
    mindbody_synced_state text,
    mindbody_synced_at timestamp with time zone,
    mindbody_sync_error text,
    mindbody_sync_attempts integer DEFAULT 0 NOT NULL,
    CONSTRAINT class_bookings_coverage_kind_check CHECK ((coverage_kind = ANY (ARRAY['membership'::text, 'pack'::text, 'none'::text]))),
    CONSTRAINT class_bookings_mindbody_sync_status_check CHECK (((mindbody_sync_status IS NULL) OR (mindbody_sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'failed'::text, 'skipped'::text])))),
    CONSTRAINT class_bookings_mindbody_synced_state_check CHECK (((mindbody_synced_state IS NULL) OR (mindbody_synced_state = ANY (ARRAY['in'::text, 'waitlist'::text, 'out'::text])))),
    CONSTRAINT class_bookings_status_check CHECK ((status = ANY (ARRAY['booked'::text, 'waitlisted'::text, 'cancelled'::text, 'late_cancelled'::text, 'checked_in'::text, 'no_show'::text])))
);


--
-- Name: class_occurrences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mindbody_class_schedule_id bigint,
    class_name text,
    class_format text,
    instructor_name text,
    max_capacity integer,
    total_booked integer,
    total_signed_in integer,
    fill_rate numeric,
    sync_timestamp timestamp without time zone,
    web_capacity integer,
    staff_id uuid,
    department_id uuid,
    room_id uuid,
    attendance_rate numeric,
    early_cancel_count integer,
    late_cancel_count integer,
    waitlist_count integer,
    substitution boolean DEFAULT false,
    substitute_staff_id uuid,
    mindbody_occurrence_id bigint,
    organization_id uuid,
    start_datetime timestamp with time zone,
    end_datetime timestamp with time zone,
    followup_reminder_sent_at timestamp with time zone,
    counts_read_at timestamp with time zone,
    synqiq_signed_in integer DEFAULT 0 NOT NULL,
    class_session_id uuid,
    pay_override_cents integer,
    assistant_staff_id uuid,
    assistant_pay_cents integer
);


--
-- Name: COLUMN class_occurrences.mindbody_class_schedule_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.class_occurrences.mindbody_class_schedule_id IS 'MindBody recurring series id (GET /class/classes[].ClassScheduleId). Shared by every occurrence of the same recurring class. NOT unique per row -- do not use for upsert/identity.';


--
-- Name: COLUMN class_occurrences.mindbody_occurrence_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.class_occurrences.mindbody_occurrence_id IS 'MindBody class instance id (GET /class/classes[].Id). Unique per occurrence, stable across re-syncs. This is the row identity key.';


--
-- Name: class_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    class_schedule_id uuid NOT NULL,
    class_type_id uuid,
    class_name text NOT NULL,
    local_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    mindbody_resource_id integer,
    capacity integer,
    staff_mindbody_id bigint,
    mindbody_class_schedule_id integer,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_from_schedule_at timestamp with time zone,
    edits jsonb DEFAULT '{}'::jsonb NOT NULL,
    staff_id uuid,
    assistant_staff_id uuid,
    layout_id uuid,
    pay_override_cents integer,
    assistant_pay_cents integer,
    waitlist_capacity integer,
    online_capacity integer,
    is_free boolean DEFAULT false NOT NULL,
    pay_later boolean DEFAULT false NOT NULL
);


--
-- Name: class_visits_mindbody; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_visits_mindbody (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    occurrence_id uuid NOT NULL,
    client_mindbody_unique_id integer NOT NULL,
    signed_in boolean NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_unique_id integer NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    status text NOT NULL,
    is_prospect boolean NOT NULL,
    creation_date timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    mindbody_client_id text,
    email_promotions boolean
);


--
-- Name: COLUMN clients.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.email IS 'Member email, synced from MindBody GET /client/clients but persisted only for clients with a signed_in class_visit (see lib/sync/clients.ts). Null for everyone else by design.';


--
-- Name: class_visits; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.class_visits WITH (security_invoker='true') AS
 SELECT v.id,
    v.organization_id,
    v.occurrence_id,
    v.client_mindbody_unique_id,
    (v.signed_in OR (EXISTS ( SELECT 1
           FROM (((public.class_bookings b
             JOIN public.class_sessions s ON ((s.id = b.class_session_id)))
             JOIN public.clients cl ON (((cl.organization_id = b.organization_id) AND (cl.mindbody_client_id = b.mindbody_client_id))))
             JOIN public.class_occurrences o ON (((o.organization_id = b.organization_id) AND ((o.class_session_id = s.id) OR ((o.mindbody_class_schedule_id = s.mindbody_class_schedule_id) AND (o.start_datetime = s.starts_at))))))
          WHERE ((o.id = v.occurrence_id) AND (cl.mindbody_unique_id = v.client_mindbody_unique_id) AND (b.status = 'checked_in'::text))))) AS signed_in,
    v.synced_at
   FROM public.class_visits_mindbody v
UNION ALL
 SELECT b.id,
    b.organization_id,
    o.id AS occurrence_id,
    cl.mindbody_unique_id AS client_mindbody_unique_id,
    (b.status = 'checked_in'::text) AS signed_in,
    b.updated_at AS synced_at
   FROM (((public.class_bookings b
     JOIN public.class_sessions s ON ((s.id = b.class_session_id)))
     JOIN public.class_occurrences o ON (((o.organization_id = b.organization_id) AND ((o.class_session_id = s.id) OR ((o.mindbody_class_schedule_id = s.mindbody_class_schedule_id) AND (o.start_datetime = s.starts_at))))))
     JOIN public.clients cl ON (((cl.organization_id = b.organization_id) AND (cl.mindbody_client_id = b.mindbody_client_id))))
  WHERE ((b.status = ANY (ARRAY['booked'::text, 'checked_in'::text, 'no_show'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.class_visits_mindbody v
          WHERE ((v.organization_id = b.organization_id) AND (v.occurrence_id = o.id) AND (v.client_mindbody_unique_id = cl.mindbody_unique_id))))));


--
-- Name: class_occurrences(public.class_visits); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.class_occurrences(public.class_visits) RETURNS SETOF public.class_occurrences
    LANGUAGE sql STABLE ROWS 1
    AS $_$
  select * from public.class_occurrences where id = $1.occurrence_id
$_$;


--
-- Name: crm_rate_limit_hit(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_rate_limit_hit(p_key text, p_window_seconds integer, p_limit integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into rate_limit_counters as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning count into v_count;
  delete from rate_limit_counters where window_start < now() - interval '2 days';
  return v_count <= p_limit;
end;
$$;


--
-- Name: newsletter_audience(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.newsletter_audience(p_org uuid, p_filters jsonb) RETURNS TABLE(contact_id uuid, client_id uuid, email text, first_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select * from private.newsletter_audience(p_org, p_filters) $$;


--
-- Name: refresh_synqiq_signed_in(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_synqiq_signed_in(p_org uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select private.refresh_synqiq_signed_in(p_org, null) $$;


--
-- Name: supersede_substitution_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.supersede_substitution_request(p_occurrence_id uuid, p_reason text DEFAULT NULL::text) RETURNS TABLE(superseded_request_id uuid, new_request_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_caller_staff_id uuid := private.current_staff_id();
  v_caller_org_id uuid := private.current_staff_org_id();
  v_occurrence record;
  v_existing record;
  v_new_id uuid;
begin
  if v_caller_staff_id is null then
    raise exception 'Not an authenticated staff member.';
  end if;

  select id, organization_id, substitute_staff_id
    into v_occurrence
    from class_occurrences
    where id = p_occurrence_id
      and organization_id = v_caller_org_id;

  if not found then
    raise exception 'Class occurrence not found.';
  end if;

  -- Only the instructor CURRENTLY assigned as the covering substitute may
  -- call this. The original requester's own cancel-and-reopen path is
  -- unchanged -- it still goes through substitution_requests_update_own +
  -- substitution_requests_insert_own directly, not this function.
  if v_occurrence.substitute_staff_id is distinct from v_caller_staff_id then
    raise exception 'Only the instructor currently assigned to cover this class can supersede it.';
  end if;

  select id, status
    into v_existing
    from substitution_requests
    where occurrence_id = p_occurrence_id
      and status = 'approved'
    for update;

  if not found then
    raise exception 'No approved substitution request exists for this occurrence.';
  end if;

  update substitution_requests
    set status = 'cancelled', resolved_at = now()
    where id = v_existing.id;

  update class_occurrences
    set substitute_staff_id = null
    where id = p_occurrence_id;

  insert into substitution_requests (occurrence_id, organization_id, requested_by, status, reason)
    values (p_occurrence_id, v_occurrence.organization_id, v_caller_staff_id, 'open', p_reason)
    returning id into v_new_id;

  return query select v_existing.id, v_new_id;
end;
$$;


--
-- Name: Locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Locations" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text,
    timezone text DEFAULT 'America/Chicago'::text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    mindbody_location_id integer
);


--
-- Name: COLUMN "Locations".mindbody_location_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."Locations".mindbody_location_id IS 'MindBody Location.Id (GET /site/locations). Unique per location.';


--
-- Name: agreement_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agreement_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    template_id uuid,
    template_version integer NOT NULL,
    sale_id uuid,
    pos_item_id uuid,
    item_name text NOT NULL,
    mindbody_client_id text,
    crm_contact_id uuid,
    client_name text,
    title text NOT NULL,
    body text NOT NULL,
    body_sha256 text NOT NULL,
    signer_name text NOT NULL,
    method text NOT NULL,
    signature_path text,
    pdf_path text NOT NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    staff_id uuid,
    ip text,
    user_agent text,
    CONSTRAINT agreement_signatures_check CHECK (((method = 'typed'::text) OR (signature_path IS NOT NULL))),
    CONSTRAINT agreement_signatures_method_check CHECK ((method = ANY (ARRAY['drawn'::text, 'typed'::text])))
);


--
-- Name: agreement_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agreement_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    body text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_staff_id uuid,
    CONSTRAINT agreement_templates_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 100000))),
    CONSTRAINT agreement_templates_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))
);


--
-- Name: appointment_occurrences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mindbody_appointment_id bigint NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid,
    location_id uuid,
    client_id text,
    session_type_id integer,
    status text NOT NULL,
    start_datetime timestamp with time zone NOT NULL,
    end_datetime timestamp with time zone,
    duration_minutes integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_occurrences_status_check CHECK ((status = ANY (ARRAY['Booked'::text, 'Confirmed'::text, 'Arrived'::text, 'Completed'::text, 'NoShow'::text])))
);


--
-- Name: billing_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    member_contract_id uuid,
    kind text NOT NULL,
    amount_cents integer,
    percent numeric(5,2),
    starts_on date NOT NULL,
    ends_on date,
    reason text NOT NULL,
    created_by_staff_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by_staff_id uuid,
    cancel_reason text,
    reason_category text,
    CONSTRAINT billing_adjustments_amount_cents_check CHECK (((amount_cents IS NULL) OR (amount_cents >= 0))),
    CONSTRAINT billing_adjustments_check CHECK (((ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT billing_adjustments_kind_check CHECK ((kind = ANY (ARRAY['credit'::text, 'discount_once'::text, 'discount_ongoing'::text, 'freeze'::text, 'cancel'::text, 'set_amount'::text]))),
    CONSTRAINT billing_adjustments_percent_check CHECK (((percent IS NULL) OR ((percent > (0)::numeric) AND (percent <= (100)::numeric)))),
    CONSTRAINT billing_adjustments_reason_category_check CHECK (((reason_category IS NULL) OR (reason_category = ANY (ARRAY['moving'::text, 'switching'::text, 'non_use'::text, 'class_quality'::text, 'other'::text])))),
    CONSTRAINT billing_adjustments_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0)),
    CONSTRAINT billing_adjustments_shape_check CHECK ((((kind = 'credit'::text) AND (amount_cents > 0) AND (percent IS NULL) AND (reason_category IS NULL)) OR ((kind = ANY (ARRAY['discount_once'::text, 'discount_ongoing'::text])) AND ((amount_cents IS NULL) <> (percent IS NULL)) AND (COALESCE(amount_cents, 1) > 0) AND (reason_category IS NULL)) OR ((kind = 'freeze'::text) AND (amount_cents IS NULL) AND (percent IS NULL) AND (ends_on IS NOT NULL) AND (reason_category IS NULL)) OR ((kind = 'cancel'::text) AND (amount_cents IS NULL) AND (percent IS NULL) AND (ends_on IS NULL) AND (reason_category IS NOT NULL)) OR ((kind = 'set_amount'::text) AND (amount_cents IS NOT NULL) AND (percent IS NULL) AND (member_contract_id IS NOT NULL) AND (reason_category IS NULL))))
);


--
-- Name: billing_cutover_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_cutover_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_contract_id bigint NOT NULL,
    member_mindbody_client_id text NOT NULL,
    payer_mindbody_client_id text NOT NULL,
    member_name text,
    payer_name text,
    contract_name text NOT NULL,
    autopay_status text,
    first_bill_date date,
    bill_day integer,
    subtotal_cents integer,
    tax_cents integer,
    total_cents integer,
    remaining_payments integer,
    auto_renews boolean DEFAULT false NOT NULL,
    basis text,
    contract_end_date date,
    status text DEFAULT 'planned'::text NOT NULL,
    excluded_reason text,
    excluded_by_staff boolean DEFAULT false NOT NULL,
    schedule_id uuid,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    card_link_sent_at timestamp with time zone,
    CONSTRAINT billing_cutover_rows_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'excluded'::text, 'activated'::text])))
);


--
-- Name: billing_cutover_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_cutover_settings (
    organization_id uuid NOT NULL,
    cutover_date date DEFAULT '2027-01-01'::date NOT NULL,
    snapshot_at timestamp with time zone,
    snapshot_by_staff_id uuid,
    locked_at timestamp with time zone,
    locked_by_staff_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_overage_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_overage_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    month date NOT NULL,
    texts_sent integer NOT NULL,
    texts_over integer NOT NULL,
    amount_cents integer NOT NULL,
    stripe_invoice_item_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_test_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_test_members (
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    added_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: board_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone
);


--
-- Name: board_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    author_staff_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by_staff_id uuid
);


--
-- Name: card_expiry_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_expiry_notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    card_exp_month integer NOT NULL,
    card_exp_year integer NOT NULL,
    notice text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_expiry_notices_notice_check CHECK ((notice = ANY (ARRAY['first'::text, 'second'::text])))
);


--
-- Name: card_update_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_update_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    token_hash text NOT NULL,
    reason text DEFAULT 'staff'::text NOT NULL,
    created_by_staff_id uuid,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text DEFAULT 'dues'::text NOT NULL,
    CONSTRAINT card_update_links_purpose_check CHECK ((purpose = ANY (ARRAY['dues'::text, 'retail'::text, 'either'::text]))),
    CONSTRAINT card_update_links_reason_check CHECK ((reason = ANY (ARRAY['staff'::text, 'declined'::text, 'expiring'::text])))
);


--
-- Name: catalog_edits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_edits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    entity text NOT NULL,
    row_id uuid NOT NULL,
    changes jsonb NOT NULL,
    edited_by_staff_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_edits_entity_check CHECK ((entity = ANY (ARRAY['class_type'::text, 'class_schedule'::text, 'room'::text, 'program'::text, 'session_type'::text, 'class_session'::text])))
);


--
-- Name: check_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.check_ins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    client_name text NOT NULL,
    checked_in_at timestamp with time zone DEFAULT now() NOT NULL,
    local_date date NOT NULL,
    checked_in_by_staff_id uuid,
    method text DEFAULT 'front_desk'::text NOT NULL,
    coverage_kind text NOT NULL,
    coverage_name text,
    mindbody_client_service_id bigint,
    member_contract_id uuid,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text,
    voided_at timestamp with time zone,
    voided_by_staff_id uuid,
    void_reason text,
    billing_standing text DEFAULT 'none'::text NOT NULL,
    standing_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT check_ins_billing_standing_check CHECK ((billing_standing = ANY (ARRAY['good'::text, 'attention'::text, 'none'::text]))),
    CONSTRAINT check_ins_coverage_kind_check CHECK ((coverage_kind = ANY (ARRAY['membership'::text, 'pass'::text, 'none'::text]))),
    CONSTRAINT check_ins_method_check CHECK ((method = ANY (ARRAY['front_desk'::text, 'scan'::text, 'kiosk'::text])))
);


--
-- Name: class_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    request_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    client_name text,
    class_name text NOT NULL,
    class_style text NOT NULL,
    class_start timestamp with time zone NOT NULL,
    quarter text NOT NULL,
    stars smallint NOT NULL,
    comment text,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_ratings_comment_check CHECK (((comment IS NULL) OR (char_length(comment) <= 2000))),
    CONSTRAINT class_ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5)))
);


--
-- Name: class_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_class_schedule_id integer,
    mindbody_class_description_id integer,
    class_name text,
    days smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    start_date date,
    end_date date,
    staff_mindbody_id bigint,
    mindbody_location_id integer,
    frequency_type text,
    frequency_interval integer,
    is_available boolean,
    mindbody_resource_id integer,
    capacity integer,
    web_capacity integer,
    last_class_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    edits jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'mindbody'::text NOT NULL,
    class_type_id uuid,
    created_by_staff_id uuid,
    staff_id uuid,
    assistant_staff_id uuid,
    room_id uuid,
    layout_id uuid,
    pay_override_cents integer,
    assistant_pay_cents integer,
    waitlist_capacity integer,
    online_capacity integer,
    is_free boolean DEFAULT false NOT NULL,
    pay_later boolean DEFAULT false NOT NULL,
    CONSTRAINT class_schedules_assistant_pay_cents_check CHECK (((assistant_pay_cents IS NULL) OR ((assistant_pay_cents >= 0) AND (assistant_pay_cents <= 100000)))),
    CONSTRAINT class_schedules_online_capacity_check CHECK (((online_capacity IS NULL) OR ((online_capacity >= 0) AND (online_capacity <= 500)))),
    CONSTRAINT class_schedules_pay_override_cents_check CHECK (((pay_override_cents IS NULL) OR ((pay_override_cents >= 0) AND (pay_override_cents <= 100000)))),
    CONSTRAINT class_schedules_source_check CHECK ((source = ANY (ARRAY['mindbody'::text, 'synqiq'::text]))),
    CONSTRAINT class_schedules_waitlist_capacity_check CHECK (((waitlist_capacity IS NULL) OR ((waitlist_capacity >= 0) AND (waitlist_capacity <= 200))))
);


--
-- Name: class_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    department_id uuid NOT NULL,
    room_id uuid,
    mindbody_schedule_id bigint,
    class_name text NOT NULL,
    day_of_week smallint NOT NULL,
    start_time time without time zone NOT NULL,
    duration_minutes smallint NOT NULL,
    capacity smallint NOT NULL,
    active boolean DEFAULT true NOT NULL,
    primary_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: class_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_class_description_id integer,
    name text NOT NULL,
    description_html text,
    description_text text,
    image_url text,
    level text,
    notes text,
    prerequisites text,
    mindbody_program_id integer,
    mindbody_session_type_id integer,
    category text,
    subcategory text,
    active boolean DEFAULT true NOT NULL,
    mindbody_updated_at timestamp without time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    edits jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'mindbody'::text NOT NULL,
    created_by_staff_id uuid,
    mindbody_image_url text,
    image_source text,
    image_copied_from text,
    CONSTRAINT class_types_image_source_check CHECK ((image_source = ANY (ARRAY['mindbody'::text, 'synqiq'::text]))),
    CONSTRAINT class_types_source_check CHECK ((source = ANY (ARRAY['mindbody'::text, 'synqiq'::text])))
);


--
-- Name: commission_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_items (
    organization_id uuid NOT NULL,
    product_id bigint NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'none'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_staff_id uuid,
    CONSTRAINT commission_items_category_check CHECK ((category = ANY (ARRAY['membership'::text, 'enrollment_fee'::text, 'pt_package'::text, 'retail'::text, 'other'::text, 'none'::text])))
);


--
-- Name: commission_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    kind text NOT NULL,
    mindbody_sale_id bigint NOT NULL,
    mindbody_sale_detail_id bigint NOT NULL,
    mindbody_client_id text,
    sale_at timestamp with time zone NOT NULL,
    earned_at timestamp with time zone NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    condition text NOT NULL,
    plan_id uuid,
    rule_id uuid,
    quantity numeric(10,2) DEFAULT 1 NOT NULL,
    base_cents integer NOT NULL,
    percent numeric(5,2),
    flat_cents integer,
    amount_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    share_percent numeric(5,2) DEFAULT 100 NOT NULL,
    CONSTRAINT commission_lines_kind_check CHECK ((kind = ANY (ARRAY['earn'::text, 'clawback'::text])))
);


--
-- Name: commission_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    default_roles text[] DEFAULT '{}'::text[] NOT NULL,
    default_trainers boolean DEFAULT false NOT NULL,
    default_enabled boolean DEFAULT true NOT NULL,
    earn_on text DEFAULT 'sale'::text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commission_plans_earn_on_check CHECK ((earn_on = ANY (ARRAY['sale'::text, 'payment'::text]))),
    CONSTRAINT commission_plans_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))
);


--
-- Name: commission_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    category text NOT NULL,
    condition text DEFAULT 'any'::text NOT NULL,
    percent numeric(5,2),
    flat_cents integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commission_rules_category_check CHECK ((category = ANY (ARRAY['membership'::text, 'enrollment_fee'::text, 'pt_package'::text, 'retail'::text, 'other'::text]))),
    CONSTRAINT commission_rules_check CHECK (((percent IS NOT NULL) OR (flat_cents IS NOT NULL))),
    CONSTRAINT commission_rules_condition_check CHECK ((condition = ANY (ARRAY['any'::text, 'new_membership'::text, 'new_pt_client'::text, 'handoff'::text]))),
    CONSTRAINT commission_rules_flat_cents_check CHECK (((flat_cents IS NULL) OR (flat_cents >= 0))),
    CONSTRAINT commission_rules_percent_check CHECK (((percent IS NULL) OR ((percent >= (0)::numeric) AND (percent <= (100)::numeric))))
);


--
-- Name: commission_sale_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_sale_credits (
    organization_id uuid NOT NULL,
    mindbody_sale_detail_id bigint NOT NULL,
    staff_id uuid NOT NULL,
    share_percent numeric(5,2) DEFAULT 100 NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    set_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commission_sale_credits_share_percent_check CHECK (((share_percent > (0)::numeric) AND (share_percent <= (100)::numeric))),
    CONSTRAINT commission_sale_credits_source_check CHECK ((source = ANY (ARRAY['import'::text, 'manual'::text, 'pos'::text])))
);


--
-- Name: commission_sale_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_sale_flags (
    organization_id uuid NOT NULL,
    mindbody_sale_detail_id bigint NOT NULL,
    handoff_approved boolean DEFAULT false NOT NULL,
    note text,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    set_by_staff_id uuid,
    no_commission boolean DEFAULT false NOT NULL
);


--
-- Name: crm_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    staff_id uuid,
    scheduled_at timestamp with time zone NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    visit_id uuid,
    created_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_appointments_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'showed'::text, 'no_show'::text, 'canceled'::text])))
);


--
-- Name: crm_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    date_of_birth date,
    email text,
    email_normalized text,
    phone_e164 text,
    address_line1 text,
    city text,
    state text,
    postal_code text,
    status text DEFAULT 'guest'::text NOT NULL,
    source text NOT NULL,
    how_heard text[] DEFAULT '{}'::text[] NOT NULL,
    referring_client_id uuid,
    referrer_name_typed text,
    referrer_unresolved boolean DEFAULT false NOT NULL,
    photo_path text,
    assigned_staff_id uuid,
    email_consent boolean DEFAULT false NOT NULL,
    email_consent_at timestamp with time zone,
    sms_consent boolean DEFAULT false NOT NULL,
    sms_consent_at timestamp with time zone,
    photo_consent boolean DEFAULT false NOT NULL,
    photo_consent_at timestamp with time zone,
    email_check_status text DEFAULT 'pending'::text NOT NULL,
    email_check_result jsonb,
    email_checked_at timestamp with time zone,
    mindbody_client_id text,
    mindbody_sync_status text DEFAULT 'not_synced'::text NOT NULL,
    possible_duplicate_of uuid,
    merged_into_id uuid,
    created_by_staff_id uuid,
    created_by_kiosk_device_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mindbody_synced_at timestamp with time zone,
    mindbody_sync_error text,
    referrer_set_at timestamp with time zone,
    referrer_set_by_staff_id uuid,
    not_interested_at timestamp with time zone,
    deleted_at timestamp with time zone,
    deleted_by_staff_id uuid,
    email_alias text,
    sms_opted_out_at timestamp with time zone,
    last_message_at timestamp with time zone,
    closed_at timestamp with time zone,
    closed_by_staff_id uuid,
    close_source text,
    mindbody_member_at_link boolean DEFAULT false NOT NULL,
    member_enrolled_at timestamp with time zone,
    membership_name text,
    membership_sold_by_staff_id uuid,
    enrollment_detected_at timestamp with time zone,
    enrollment_status text,
    trainer_staff_id uuid,
    trainer_assigned_at timestamp with time zone,
    trainer_assigned_by_staff_id uuid,
    follow_up_on date,
    follow_up_set_at timestamp with time zone,
    follow_up_set_by_staff_id uuid,
    enrollment_kind text,
    enrollment_note text,
    created_by_lead_form_id uuid,
    intro_declined_at timestamp with time zone,
    intro_declined_by_staff_id uuid,
    intro_declined_reason text,
    import_batch_id uuid,
    external_ref text,
    import_data jsonb,
    warm_pool_at timestamp with time zone,
    imported_activity_at timestamp with time zone,
    CONSTRAINT crm_contacts_close_source_check CHECK ((close_source = ANY (ARRAY['manual'::text, 'mindbody'::text]))),
    CONSTRAINT crm_contacts_email_check_status_check CHECK ((email_check_status = ANY (ARRAY['pending'::text, 'deliverable'::text, 'undeliverable'::text, 'risky'::text, 'unknown'::text, 'skipped'::text]))),
    CONSTRAINT crm_contacts_enrollment_kind_check CHECK ((enrollment_kind = ANY (ARRAY['new'::text, 'returning'::text]))),
    CONSTRAINT crm_contacts_enrollment_status_check CHECK ((enrollment_status = ANY (ARRAY['pending'::text, 'found'::text, 'no_contract'::text, 'not_counted'::text]))),
    CONSTRAINT crm_contacts_mindbody_sync_status_check CHECK ((mindbody_sync_status = ANY (ARRAY['not_synced'::text, 'pending'::text, 'synced'::text, 'failed'::text, 'member_review'::text]))),
    CONSTRAINT crm_contacts_source_check CHECK ((source = ANY (ARRAY['walk_in'::text, 'guest_of_member'::text, 'phone_in'::text, 'web'::text, 'other'::text, 'member'::text]))),
    CONSTRAINT crm_contacts_status_check CHECK ((status = ANY (ARRAY['guest'::text, 'lead'::text, 'member'::text, 'not_interested'::text])))
);


--
-- Name: crm_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    source text NOT NULL,
    filename text,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    undone_at timestamp with time zone,
    undone_by_staff_id uuid,
    CONSTRAINT crm_import_batches_source_check CHECK ((source = ANY (ARRAY['gymsales'::text, 'gymsales_activity'::text])))
);


--
-- Name: crm_imported_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_imported_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    import_batch_id uuid NOT NULL,
    kind text NOT NULL,
    direction text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    outcome text,
    body text,
    subject text,
    sent_by_name text,
    next_action text,
    person_name text NOT NULL,
    source_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_imported_activity_direction_check CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text]))),
    CONSTRAINT crm_imported_activity_kind_check CHECK ((kind = ANY (ARRAY['call'::text, 'sms'::text, 'email'::text])))
);


--
-- Name: crm_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    kind text NOT NULL,
    contact_id uuid NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_jobs_kind_check CHECK ((kind = ANY (ARRAY['email_check'::text, 'mindbody_push'::text, 'member_contract'::text]))),
    CONSTRAINT crm_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: crm_kpi_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_kpi_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    month date NOT NULL,
    staff_id uuid,
    metric text NOT NULL,
    target numeric(10,2) NOT NULL,
    updated_by_staff_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_kpi_targets_metric_check CHECK ((metric ~ '^[a-z_]{1,40}$'::text)),
    CONSTRAINT crm_kpi_targets_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric)),
    CONSTRAINT crm_kpi_targets_target_check CHECK (((target >= (0)::numeric) AND (target <= (1000000)::numeric)))
);


--
-- Name: crm_lead_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_lead_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    token_hash text,
    how_heard_label text,
    assigned_staff_id uuid,
    revoked_at timestamp with time zone,
    last_received_at timestamp with time zone,
    submission_count integer DEFAULT 0 NOT NULL,
    created_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_lead_forms_how_heard_label_check CHECK (((how_heard_label IS NULL) OR ((char_length(how_heard_label) >= 1) AND (char_length(how_heard_label) <= 60)))),
    CONSTRAINT crm_lead_forms_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))
);


--
-- Name: crm_marketing_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_marketing_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_marketing_sources_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 60)))
);


--
-- Name: crm_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    channel text NOT NULL,
    direction text NOT NULL,
    body text NOT NULL,
    subject text,
    sent_by_staff_id uuid,
    status text DEFAULT 'queued'::text NOT NULL,
    provider_message_id text,
    error text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    from_address text,
    CONSTRAINT crm_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 20000))),
    CONSTRAINT crm_messages_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text, 'call'::text, 'web'::text]))),
    CONSTRAINT crm_messages_direction_check CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text]))),
    CONSTRAINT crm_messages_from_address_check CHECK (((from_address IS NULL) OR (char_length(from_address) <= 320))),
    CONSTRAINT crm_messages_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'received'::text])))
);


--
-- Name: crm_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    author_staff_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_notes_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 5000)))
);


--
-- Name: crm_pending_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_pending_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    submitted_contact_id uuid NOT NULL,
    candidate_contact_id uuid NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_by_staff_id uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_pending_matches_reason_check CHECK ((reason = ANY (ARRAY['partial_match'::text, 'name_mismatch'::text, 'declined_match'::text]))),
    CONSTRAINT crm_pending_matches_status_check CHECK ((status = ANY (ARRAY['open'::text, 'merged'::text, 'kept_separate'::text])))
);


--
-- Name: crm_spam_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_spam_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lead_form_id uuid,
    fingerprint text NOT NULL,
    first_name text,
    last_name text,
    email text,
    phone text,
    message text,
    lead jsonb NOT NULL,
    reasons text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    released_by_staff_id uuid,
    released_contact_id uuid
);


--
-- Name: department_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    department_id uuid NOT NULL,
    category text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT department_categories_category_check CHECK ((category = ANY (ARRAY['pilates'::text, 'group_fitness'::text, 'yoga'::text, 'cycle'::text, 'pool_lanes'::text])))
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid,
    mindbody_service_category_id bigint,
    name text,
    active boolean DEFAULT true,
    mindbody_program_id integer,
    organization_id uuid NOT NULL,
    schedule_type text,
    cancel_window_minutes integer,
    booking_opens_days integer,
    booking_closes_minutes integer,
    paid_by jsonb DEFAULT '[]'::jsonb NOT NULL,
    pays_for jsonb DEFAULT '[]'::jsonb NOT NULL,
    synced_at timestamp with time zone,
    edits jsonb DEFAULT '{}'::jsonb NOT NULL,
    required_item_id uuid
);


--
-- Name: COLUMN departments.mindbody_program_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.departments.mindbody_program_id IS 'MindBody Program.Id (ClassDescription.Program, via GET /class/classdescriptions). The real source for "department" -- always populated, unlike mindbody_service_category_id.';


--
-- Name: COLUMN departments.booking_opens_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.departments.booking_opens_days IS 'classes: clients can book this many days ahead';


--
-- Name: email_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_settings (
    organization_id uuid NOT NULL,
    signature text,
    footer text,
    show_logo boolean DEFAULT true NOT NULL,
    updated_by_staff_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_settings_footer_check CHECK (((footer IS NULL) OR (length(footer) <= 1000))),
    CONSTRAINT email_settings_signature_check CHECK (((signature IS NULL) OR (length(signature) <= 500)))
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    organization_id uuid NOT NULL,
    key text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    updated_by_staff_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_templates_body_check CHECK (((length(body) >= 1) AND (length(body) <= 5000))),
    CONSTRAINT email_templates_key_check CHECK ((key = ANY (ARRAY['payment_declined'::text, 'payment_on_hold'::text, 'card_expiring'::text, 'card_expiring_reminder'::text, 'card_link'::text, 'card_cutover'::text, 'rating_request'::text, 'class_followup_reminder'::text]))),
    CONSTRAINT email_templates_subject_check CHECK (((length(subject) >= 1) AND (length(subject) <= 200)))
);


--
-- Name: email_unsubscribes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_unsubscribes (
    organization_id uuid NOT NULL,
    email_normalized text NOT NULL,
    newsletter_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fitness_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fitness_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    month date NOT NULL,
    sessions_goal integer,
    sales_goal_cents bigint,
    updated_by_staff_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fitness_goals_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric)),
    CONSTRAINT fitness_goals_sales_goal_cents_check CHECK (((sales_goal_cents IS NULL) OR ((sales_goal_cents >= 0) AND (sales_goal_cents <= '100000000000'::bigint)))),
    CONSTRAINT fitness_goals_sessions_goal_check CHECK (((sessions_goal IS NULL) OR ((sessions_goal >= 0) AND (sessions_goal <= 100000))))
);


--
-- Name: followup_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.followup_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    instructor_id uuid NOT NULL,
    client_id uuid NOT NULL,
    alias text NOT NULL,
    client_email text NOT NULL,
    instructor_email text NOT NULL,
    subject text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: followup_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.followup_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    direction text NOT NULL,
    from_email text NOT NULL,
    to_email text NOT NULL,
    body_text text NOT NULL,
    resend_message_id text,
    provider_message_id text,
    in_reply_to text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT followup_messages_direction_check CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text])))
);


--
-- Name: guest_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    visit_at timestamp with time zone DEFAULT now() NOT NULL,
    visit_type text NOT NULL,
    assigned_staff_id uuid,
    kiosk_device_id uuid,
    created_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guest_visits_visit_type_check CHECK ((visit_type = ANY (ARRAY['appointment'::text, 'trial_visit'::text, 'walk_in'::text, 'guest_visit'::text])))
);


--
-- Name: included_item_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.included_item_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    item_id uuid NOT NULL,
    mindbody_product_id text,
    pos_item_id uuid,
    CONSTRAINT included_item_grants_check CHECK (((mindbody_product_id IS NOT NULL) <> (pos_item_id IS NOT NULL)))
);


--
-- Name: included_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.included_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT included_items_name_check CHECK (((length(name) >= 1) AND (length(name) <= 60)))
);


--
-- Name: instructor_class_eligibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instructor_class_eligibility (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    department_id uuid NOT NULL,
    class_name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE instructor_class_eligibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.instructor_class_eligibility IS 'Admin-togglable per-instructor qualification for a (department, class_name) pair. Absence of a row means not eligible -- rows are only created when eligible at least once (seed) or explicitly toggled (admin action); check with LEFT JOIN + COALESCE(enabled, false), not a required lookup.';


--
-- Name: COLUMN instructor_class_eligibility.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.instructor_class_eligibility.updated_by IS 'Staff member who last toggled this row. NULL means system-seeded, never manually touched. Two FKs to staff exist on this table (staff_id, updated_by) -- embedded-resource queries need an explicit FK-constraint hint to disambiguate, same as class_occurrences.staff_id / substitute_staff_id.';


--
-- Name: instructor_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instructor_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    import_batch_id uuid NOT NULL,
    row_hash text NOT NULL,
    date_of_service date NOT NULL,
    staff_id uuid NOT NULL,
    staff_name_raw text NOT NULL,
    client_name text NOT NULL,
    service_name text,
    rating smallint NOT NULL,
    review_text text,
    helpful_count integer DEFAULT 0 NOT NULL,
    not_helpful_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instructor_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: inventory_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_categories_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)))
);


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    pos_item_id uuid NOT NULL,
    kind text NOT NULL,
    quantity integer NOT NULL,
    note text,
    staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_movements_check CHECK (((kind = 'count'::text) OR (quantity > 0))),
    CONSTRAINT inventory_movements_kind_check CHECK ((kind = ANY (ARRAY['count'::text, 'received'::text]))),
    CONSTRAINT inventory_movements_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
    CONSTRAINT inventory_movements_quantity_check CHECK (((quantity >= 0) AND (quantity <= 100000)))
);


--
-- Name: kiosk_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiosk_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    activation_code_hash text,
    activation_expires_at timestamp with time zone,
    token_hash text,
    activated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    on_duty_staff_id uuid,
    on_duty_set_at timestamp with time zone,
    CONSTRAINT kiosk_devices_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))
);


--
-- Name: kiosk_match_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiosk_match_tokens (
    token_hash text NOT NULL,
    organization_id uuid NOT NULL,
    kiosk_device_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    studio_name text NOT NULL,
    website text,
    phone text,
    email text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: maintenance_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    area text,
    model_number text,
    serial_number text,
    is_critical boolean DEFAULT false NOT NULL,
    owner_staff_id uuid,
    default_vendor_id uuid,
    notes text,
    qr_token text DEFAULT encode(extensions.gen_random_bytes(9), 'hex'::text),
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: maintenance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    kind text NOT NULL,
    body text,
    amount_cents integer,
    visit_at timestamp with time zone,
    status text,
    staff_id uuid,
    vendor_id uuid,
    from_email text,
    subject text,
    provider_message_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT maintenance_events_amount_cents_check CHECK (((amount_cents IS NULL) OR (amount_cents >= 0))),
    CONSTRAINT maintenance_events_kind_check CHECK ((kind = ANY (ARRAY['reported'::text, 'note'::text, 'troubleshooting'::text, 'status'::text, 'vendor_out'::text, 'vendor_in'::text, 'visit'::text, 'quote'::text, 'paid'::text, 'resolved'::text, 'reopened'::text])))
);


--
-- Name: maintenance_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    equipment_id uuid,
    location_text text,
    title text NOT NULL,
    description text NOT NULL,
    is_critical boolean DEFAULT false NOT NULL,
    status text DEFAULT 'reported'::text NOT NULL,
    reported_by_staff_id uuid,
    vendor_id uuid,
    vendor_approved_by_staff_id uuid,
    vendor_approved_at timestamp with time zone,
    vendor_contacted_at timestamp with time zone,
    last_vendor_reply_at timestamp with time zone,
    email_alias text,
    last_message_id text,
    next_visit_at timestamp with time zone,
    resolved_at timestamp with time zone,
    resolved_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT maintenance_issues_status_check CHECK ((status = ANY (ARRAY['reported'::text, 'troubleshooting'::text, 'vendor_contacted'::text, 'vendor_replied'::text, 'visit_scheduled'::text, 'on_site'::text, 'resolved'::text])))
);


--
-- Name: maintenance_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    kind text NOT NULL,
    path text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    duration_seconds numeric,
    uploaded_by_staff_id uuid,
    uploaded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT maintenance_media_kind_check CHECK ((kind = ANY (ARRAY['photo'::text, 'video'::text])))
);


--
-- Name: maintenance_vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    contact_name text,
    email text,
    phone text,
    notes text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mbo_autopay_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mbo_autopay_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    import_batch_id uuid,
    row_hash text NOT NULL,
    charge_date date NOT NULL,
    client_name text NOT NULL,
    client_email text,
    mindbody_client_id text,
    match_method text,
    location text,
    item text NOT NULL,
    contract_associated boolean,
    card_brand text,
    card_last4 text,
    card_exp_month smallint,
    card_exp_year smallint,
    amount_cents integer NOT NULL,
    status text NOT NULL,
    status_detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mbo_autopay_rows_match_method_check CHECK ((match_method = ANY (ARRAY['email'::text, 'name'::text]))),
    CONSTRAINT mbo_autopay_rows_status_check CHECK ((status = ANY (ARRAY['success'::text, 'scheduled'::text, 'suspended'::text, 'declined'::text, 'other'::text])))
);


--
-- Name: member_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    email text NOT NULL,
    password_hash text,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    password_set_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_billing_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_billing_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    sale_id uuid,
    pos_item_id uuid,
    mindbody_client_id text,
    client_name text,
    name text NOT NULL,
    status text DEFAULT 'practice'::text NOT NULL,
    start_date date NOT NULL,
    first_bill_date date NOT NULL,
    billing_interval text DEFAULT 'month'::text NOT NULL,
    recurring_lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    recurring_subtotal_cents integer NOT NULL,
    recurring_tax_cents integer DEFAULT 0 NOT NULL,
    recurring_total_cents integer NOT NULL,
    autopay_count integer,
    auto_renews boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    source text DEFAULT 'pos'::text NOT NULL,
    mindbody_client_contract_id bigint,
    end_date date,
    crm_contact_id uuid,
    stripe_account_id text,
    stripe_customer_id text,
    stripe_payment_method_id text,
    billing_start text DEFAULT 'signup'::text NOT NULL,
    billing_state text DEFAULT 'current'::text NOT NULL,
    frozen_at timestamp with time zone,
    card_brand text,
    card_last4 text,
    card_exp_month integer,
    card_exp_year integer,
    CONSTRAINT member_billing_schedules_billing_interval_check CHECK ((billing_interval = 'month'::text)),
    CONSTRAINT member_billing_schedules_billing_start_check CHECK ((billing_start = ANY (ARRAY['signup'::text, 'prorated'::text]))),
    CONSTRAINT member_billing_schedules_billing_state_check CHECK ((billing_state = ANY (ARRAY['current'::text, 'past_due'::text, 'frozen'::text]))),
    CONSTRAINT member_billing_schedules_card_exp_month_check CHECK (((card_exp_month IS NULL) OR ((card_exp_month >= 1) AND (card_exp_month <= 12)))),
    CONSTRAINT member_billing_schedules_card_exp_year_check CHECK (((card_exp_year IS NULL) OR ((card_exp_year >= 2000) AND (card_exp_year <= 2100)))),
    CONSTRAINT member_billing_schedules_card_last4_check CHECK (((card_last4 IS NULL) OR (card_last4 ~ '^[0-9]{4}$'::text))),
    CONSTRAINT member_billing_schedules_source_check CHECK ((source = ANY (ARRAY['pos'::text, 'mindbody'::text]))),
    CONSTRAINT member_billing_schedules_status_check CHECK ((status = ANY (ARRAY['practice'::text, 'active'::text, 'cancelled'::text, 'voided'::text]))),
    CONSTRAINT member_billing_schedules_who_check CHECK (((mindbody_client_id IS NOT NULL) OR (crm_contact_id IS NOT NULL)))
);


--
-- Name: member_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_cards (
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    livemode boolean DEFAULT false NOT NULL,
    stripe_account_id text NOT NULL,
    stripe_customer_id text NOT NULL,
    stripe_payment_method_id text NOT NULL,
    card_brand text,
    card_last4 text,
    card_exp_month integer,
    card_exp_year integer,
    wallet text,
    updated_via text NOT NULL,
    updated_by_staff_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text DEFAULT 'dues'::text NOT NULL,
    CONSTRAINT member_cards_card_exp_month_check CHECK (((card_exp_month IS NULL) OR ((card_exp_month >= 1) AND (card_exp_month <= 12)))),
    CONSTRAINT member_cards_card_exp_year_check CHECK (((card_exp_year IS NULL) OR ((card_exp_year >= 2000) AND (card_exp_year <= 2100)))),
    CONSTRAINT member_cards_card_last4_check CHECK (((card_last4 IS NULL) OR (card_last4 ~ '^[0-9]{4}$'::text))),
    CONSTRAINT member_cards_purpose_check CHECK ((purpose = ANY (ARRAY['dues'::text, 'retail'::text]))),
    CONSTRAINT member_cards_updated_via_check CHECK ((updated_via = ANY (ARRAY['desk'::text, 'link'::text, 'app'::text, 'pos'::text])))
);


--
-- Name: member_contract_sync; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_contract_sync (
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    contract_count integer DEFAULT 0 NOT NULL
);


--
-- Name: member_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_contract_id bigint NOT NULL,
    mindbody_client_id text NOT NULL,
    payer_mindbody_client_id text,
    plan_id uuid,
    mindbody_contract_id integer,
    contract_name text NOT NULL,
    agreement_date date,
    start_date date,
    end_date date,
    termination_date date,
    original_start_date date,
    original_client_contract_id bigint,
    renewed_from_client_contract_id bigint,
    autopay_status text,
    auto_renewing boolean,
    is_month_to_month boolean,
    normal_autopay_cents integer,
    next_bill_date date,
    next_bill_subtotal_cents integer,
    next_bill_tax_cents integer,
    next_bill_total_cents integer,
    upcoming_autopays jsonb DEFAULT '[]'::jsonb NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_id_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_id_counters (
    organization_id uuid NOT NULL,
    next_value bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_personal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_personal (
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    mindbody jsonb DEFAULT '{}'::jsonb NOT NULL,
    mindbody_synced_at timestamp with time zone,
    edits jsonb DEFAULT '{}'::jsonb NOT NULL,
    edited_at timestamp with time zone,
    edited_by_staff_id uuid,
    phone_digits text GENERATED ALWAYS AS (((regexp_replace(COALESCE(
CASE
    WHEN (edits ? 'mobilePhone'::text) THEN (edits ->> 'mobilePhone'::text)
    ELSE (mindbody ->> 'mobilePhone'::text)
END, ''::text), '\D'::text, ''::text, 'g'::text) || '|'::text) || regexp_replace(COALESCE(
CASE
    WHEN (edits ? 'homePhone'::text) THEN (edits ->> 'homePhone'::text)
    ELSE (mindbody ->> 'homePhone'::text)
END, ''::text), '\D'::text, ''::text, 'g'::text))) STORED,
    photo_path text,
    photo_source_url text,
    photo_copied_at timestamp with time zone
);


--
-- Name: member_personal_edits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_personal_edits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    changes jsonb NOT NULL,
    edited_by_staff_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_profile_sync; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_profile_sync (
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    visits_from date NOT NULL,
    visit_count integer DEFAULT 0 NOT NULL,
    sale_count integer DEFAULT 0 NOT NULL,
    service_count integer DEFAULT 0 NOT NULL
);


--
-- Name: member_sale_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_sale_id bigint NOT NULL,
    mindbody_sale_detail_id bigint NOT NULL,
    description text NOT NULL,
    is_service boolean,
    product_id bigint,
    contract_id bigint,
    quantity numeric(10,2),
    unit_price_cents integer,
    discount_cents integer,
    tax_cents integer,
    total_cents integer,
    returned boolean DEFAULT false NOT NULL,
    recipient_unique_id bigint
);


--
-- Name: member_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_sale_id bigint NOT NULL,
    mindbody_client_id text NOT NULL,
    sale_at timestamp with time zone,
    location_id integer,
    sales_rep_mindbody_id bigint,
    total_cents integer DEFAULT 0 NOT NULL,
    payments jsonb DEFAULT '[]'::jsonb NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_service_id bigint NOT NULL,
    mindbody_client_id text NOT NULL,
    product_id bigint,
    name text NOT NULL,
    program text,
    count integer,
    remaining integer,
    is_current boolean,
    active_date date,
    expiration_date date,
    payment_date date,
    returned boolean,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent text
);


--
-- Name: member_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_visit_id bigint NOT NULL,
    mindbody_client_id text NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    start_local timestamp without time zone NOT NULL,
    end_local timestamp without time zone,
    service_name text,
    staff_mindbody_id bigint,
    location_id integer,
    class_id bigint,
    appointment_id bigint,
    appointment_status text,
    signed_in boolean,
    late_cancelled boolean,
    missed boolean,
    web_signup boolean,
    last_modified_at timestamp without time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_visits_kind_check CHECK ((kind = ANY (ARRAY['arrival'::text, 'class'::text, 'appointment'::text, 'other'::text])))
);


--
-- Name: membership_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    mindbody_client_id text,
    due_date date NOT NULL,
    subtotal_cents integer NOT NULL,
    tax_cents integer DEFAULT 0 NOT NULL,
    total_cents integer NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_on date,
    last_decline text,
    livemode boolean DEFAULT false NOT NULL,
    stripe_account_id text,
    payment_intent_id text,
    sale_id uuid,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retry_from date,
    retry_base_attempts integer DEFAULT 0 NOT NULL,
    moved_by_staff_id uuid,
    moved_at timestamp with time zone,
    decline_emailed_at timestamp with time zone,
    frozen_emailed_at timestamp with time zone,
    refunded_at timestamp with time zone,
    CONSTRAINT membership_charges_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'processing'::text, 'paid'::text, 'declined'::text, 'failed'::text, 'cancelled'::text, 'refunded'::text]))),
    CONSTRAINT membership_charges_subtotal_cents_check CHECK ((subtotal_cents >= 0)),
    CONSTRAINT membership_charges_tax_cents_check CHECK ((tax_cents >= 0)),
    CONSTRAINT membership_charges_total_cents_check CHECK ((total_cents >= 0))
);


--
-- Name: membership_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_contract_id integer,
    name text NOT NULL,
    description text,
    recurring_subtotal_cents integer,
    first_payment_subtotal_cents integer,
    autopay_frequency text,
    number_of_autopays integer,
    after_term text,
    sold_online boolean DEFAULT false NOT NULL,
    client_can_terminate_online boolean DEFAULT false NOT NULL,
    requires_signature boolean DEFAULT false NOT NULL,
    members_only boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agreement_terms text
);


--
-- Name: message_boards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_boards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    board_type text NOT NULL,
    title text NOT NULL,
    department_id uuid,
    substitution_request_id uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_boards_board_type_check CHECK ((board_type = ANY (ARRAY['announcements'::text, 'group_department'::text, 'sub_specific'::text, 'team_sales'::text, 'team_trainers'::text])))
);


--
-- Name: milestone_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.milestone_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    client_name text,
    class_count integer NOT NULL,
    class_name text,
    class_start timestamp with time zone NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by_staff_id uuid,
    decided_at timestamp with time zone,
    sent_to text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT milestone_emails_class_count_check CHECK ((class_count > 0)),
    CONSTRAINT milestone_emails_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'expired'::text, 'failed'::text])))
);


--
-- Name: milestone_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.milestone_templates (
    organization_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    milestone integer NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    disabled_by_admin boolean DEFAULT false NOT NULL,
    updated_by_staff_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT milestone_templates_body_check CHECK (((length(body) >= 1) AND (length(body) <= 5000))),
    CONSTRAINT milestone_templates_milestone_check CHECK ((milestone = ANY (ARRAY[1, 3, 10, 25, 50, 100, 200]))),
    CONSTRAINT milestone_templates_subject_check CHECK (((length(subject) >= 1) AND (length(subject) <= 200)))
);


--
-- Name: mindbody_item_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mindbody_item_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    counts boolean,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_staff_id uuid,
    CONSTRAINT mindbody_item_types_kind_check CHECK ((kind = ANY (ARRAY['contract'::text, 'sale_item'::text]))),
    CONSTRAINT mindbody_item_types_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)))
);


--
-- Name: newsletter_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_recipients (
    newsletter_id uuid NOT NULL,
    contact_id uuid,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    unsubscribe_token_hash text NOT NULL,
    sent_at timestamp with time zone,
    unsubscribed_at timestamp with time zone,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    CONSTRAINT newsletter_recipients_person_check CHECK (((contact_id IS NOT NULL) OR (client_id IS NOT NULL))),
    CONSTRAINT newsletter_recipients_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: newsletters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    scheduled_for timestamp with time zone,
    started_at timestamp with time zone,
    sent_at timestamp with time zone,
    recipient_count integer,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    created_by_staff_id uuid,
    scheduled_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT newsletters_body_check CHECK ((length(body) <= 20000)),
    CONSTRAINT newsletters_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'cancelled'::text]))),
    CONSTRAINT newsletters_subject_check CHECK ((length(subject) <= 200))
);


--
-- Name: org_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    module text NOT NULL,
    status text DEFAULT 'enabled'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_modules_module_check CHECK ((module = ANY (ARRAY['crm'::text, 'group_fitness'::text, 'trainer'::text]))),
    CONSTRAINT org_modules_status_check CHECK ((status = ANY (ARRAY['enabled'::text, 'disabled'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    subscription_plan text DEFAULT 'starter/pro/business'::text,
    status text DEFAULT 'active/inactive'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    mindbody_site_id integer,
    timezone text,
    primary_color text DEFAULT '#0f766e'::text NOT NULL,
    accent_color text DEFAULT '#0f766e'::text NOT NULL,
    logo_url text,
    font_family text DEFAULT 'Inter'::text NOT NULL,
    expected_revenue_per_session numeric DEFAULT 100 NOT NULL,
    secondary_color text DEFAULT '#0f766e'::text NOT NULL,
    crm_mindbody_push boolean DEFAULT false NOT NULL,
    crm_sms_number text,
    crm_intro_session_type_id integer,
    mindbody_connected boolean DEFAULT false NOT NULL,
    mindbody_activation_code text,
    mindbody_activation_link text,
    mindbody_activation_checked_at timestamp with time zone,
    mindbody_activated_at timestamp with time zone,
    is_demo boolean DEFAULT false NOT NULL,
    demo_generated_through date,
    custom_monthly_price numeric,
    stripe_customer_id text,
    stripe_subscription_id text,
    billing_status text,
    billing_cutover_date date DEFAULT '2027-02-01'::date NOT NULL,
    member_portal_mode text DEFAULT 'off'::text NOT NULL,
    commission_new_pt_months integer DEFAULT 6 NOT NULL,
    sales_tax_rate numeric(8,6) DEFAULT 0.0825 NOT NULL,
    trainer_availability_synced_at timestamp with time zone,
    ratings_mode text DEFAULT 'off'::text NOT NULL,
    follow_up_cadence jsonb,
    legal_name text,
    member_id_source text DEFAULT 'mindbody'::text NOT NULL,
    email_from_domain text,
    email_from_verified_at timestamp with time zone,
    email_relay_domain text,
    email_relay_verified_at timestamp with time zone,
    mindbody_booking_writeback boolean DEFAULT false NOT NULL,
    mindbody_writeback_until date DEFAULT '2027-01-21'::date NOT NULL,
    session_balances_from date DEFAULT '2026-12-18'::date NOT NULL,
    pt_no_show_uses_session boolean DEFAULT true NOT NULL,
    pt_late_cancel_uses_session boolean DEFAULT true NOT NULL,
    mindbody_disconnected_at timestamp with time zone,
    mindbody_disconnected_by_staff_id uuid,
    membership_default_items uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    classes_taken_over_at timestamp with time zone,
    CONSTRAINT organizations_accent_color_check CHECK ((accent_color ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT organizations_commission_new_pt_months_check CHECK (((commission_new_pt_months >= 1) AND (commission_new_pt_months <= 36))),
    CONSTRAINT organizations_custom_monthly_price_check CHECK ((custom_monthly_price >= (0)::numeric)),
    CONSTRAINT organizations_email_from_domain_check CHECK (((email_from_domain IS NULL) OR (email_from_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'::text))),
    CONSTRAINT organizations_email_relay_domain_check CHECK (((email_relay_domain IS NULL) OR (email_relay_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'::text))),
    CONSTRAINT organizations_expected_revenue_per_session_check CHECK ((expected_revenue_per_session > (0)::numeric)),
    CONSTRAINT organizations_font_family_check CHECK ((font_family = ANY (ARRAY['Inter'::text, 'Manrope'::text, 'Work Sans'::text, 'Sora'::text, 'Lexend'::text, 'Plus Jakarta Sans'::text, 'DM Sans'::text, 'Outfit'::text]))),
    CONSTRAINT organizations_legal_name_check CHECK (((legal_name IS NULL) OR (char_length(legal_name) <= 200))),
    CONSTRAINT organizations_member_id_source_check CHECK ((member_id_source = ANY (ARRAY['mindbody'::text, 'synqiq'::text]))),
    CONSTRAINT organizations_member_portal_mode_check CHECK ((member_portal_mode = ANY (ARRAY['off'::text, 'open'::text]))),
    CONSTRAINT organizations_primary_color_check CHECK ((primary_color ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT organizations_ratings_mode_check CHECK ((ratings_mode = ANY (ARRAY['off'::text, 'everyone'::text]))),
    CONSTRAINT organizations_sales_tax_rate_check CHECK (((sales_tax_rate >= (0)::numeric) AND (sales_tax_rate < (1)::numeric))),
    CONSTRAINT organizations_secondary_color_check CHECK ((secondary_color ~ '^#[0-9a-fA-F]{6}$'::text))
);


--
-- Name: COLUMN organizations.mindbody_site_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.mindbody_site_id IS 'MindBody Site.Id (GET /site/sites) this organization syncs from. Corresponds to the MINDBODY_SITE_ID env var for a given deployment.';


--
-- Name: COLUMN organizations.timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.timezone IS 'IANA timezone name (e.g. America/Chicago) from MindBody Site.TimeZone. One value per MindBody site -- used to interpret every naive local timestamp MindBody returns for this org''s classes.';


--
-- Name: COLUMN organizations.crm_mindbody_push; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.crm_mindbody_push IS 'CRM: send new guests/leads to Mindbody after the email check (link on email/phone match, else AddClient).';


--
-- Name: pay_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pay_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    applies_to text NOT NULL,
    method text NOT NULL,
    base_cents integer DEFAULT 0 NOT NULL,
    per_head_cents integer DEFAULT 0 NOT NULL,
    heads_above integer DEFAULT 0 NOT NULL,
    cap_cents integer,
    percent numeric(5,2),
    flat_cents integer,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_staff_id uuid,
    no_registration_cents integer,
    CONSTRAINT pay_rates_applies_to_check CHECK ((applies_to = ANY (ARRAY['class'::text, 'appointment'::text]))),
    CONSTRAINT pay_rates_base_cents_check CHECK ((base_cents >= 0)),
    CONSTRAINT pay_rates_cap_cents_check CHECK (((cap_cents IS NULL) OR (cap_cents >= 0))),
    CONSTRAINT pay_rates_check CHECK ((((applies_to = 'class'::text) AND (method = ANY (ARRAY['class_formula'::text, 'flat'::text]))) OR ((applies_to = 'appointment'::text) AND (method = ANY (ARRAY['percent'::text, 'flat'::text]))))),
    CONSTRAINT pay_rates_check1 CHECK (((method <> 'percent'::text) OR (percent IS NOT NULL))),
    CONSTRAINT pay_rates_check2 CHECK (((method <> 'flat'::text) OR (flat_cents IS NOT NULL))),
    CONSTRAINT pay_rates_flat_cents_check CHECK (((flat_cents IS NULL) OR (flat_cents >= 0))),
    CONSTRAINT pay_rates_heads_above_check CHECK ((heads_above >= 0)),
    CONSTRAINT pay_rates_method_check CHECK ((method = ANY (ARRAY['class_formula'::text, 'percent'::text, 'flat'::text]))),
    CONSTRAINT pay_rates_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120))),
    CONSTRAINT pay_rates_no_registration_cents_check CHECK (((no_registration_cents IS NULL) OR (no_registration_cents >= 0))),
    CONSTRAINT pay_rates_per_head_cents_check CHECK ((per_head_cents >= 0)),
    CONSTRAINT pay_rates_percent_check CHECK (((percent IS NULL) OR ((percent >= (0)::numeric) AND (percent <= (100)::numeric))))
);


--
-- Name: payment_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_disputes (
    id text NOT NULL,
    organization_id uuid NOT NULL,
    stripe_account_id text NOT NULL,
    livemode boolean DEFAULT false NOT NULL,
    payment_intent_id text,
    sale_id uuid,
    mindbody_client_id text,
    amount_cents integer NOT NULL,
    reason text,
    status text NOT NULL,
    evidence_due_by timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payroll_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    kind text NOT NULL,
    trainer_session_id uuid,
    work_date date NOT NULL,
    description text NOT NULL,
    client_name text,
    value_cents integer,
    value_estimated boolean DEFAULT false NOT NULL,
    value_source text,
    pay_rate_id uuid,
    pay_rate_name text,
    amount_cents integer DEFAULT 0 NOT NULL,
    no_show boolean DEFAULT false NOT NULL,
    status text DEFAULT 'practice'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_staff_id uuid,
    voided_at timestamp with time zone,
    voided_by_staff_id uuid,
    void_reason text,
    CONSTRAINT payroll_events_kind_check CHECK ((kind = 'session'::text)),
    CONSTRAINT payroll_events_status_check CHECK ((status = ANY (ARRAY['practice'::text, 'live'::text])))
);


--
-- Name: payroll_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    import_batch_id uuid NOT NULL,
    row_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    staff_id uuid,
    staff_name_raw text NOT NULL,
    class_name text NOT NULL,
    class_date date,
    weekday text,
    start_time text,
    end_time text,
    earnings_amt numeric NOT NULL,
    file_number text,
    program_code text,
    students integer
);


--
-- Name: COLUMN payroll_line_items.class_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_line_items.class_name IS 'A real class name for class rows, or a pay-category label ("Personal Training", "Hourly Pay") for lump-sum rows -- always populated.';


--
-- Name: COLUMN payroll_line_items.class_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_line_items.class_date IS 'NULL (alongside weekday/start_time/end_time) means this is a lump-sum row for a non-class pay type (Personal Training, Hourly Pay) -- earnings_amt is that row''s whole-period total, not a single session''s pay. Expected, not missing data.';


--
-- Name: COLUMN payroll_line_items.students; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_line_items.students IS 'Real headcount for a class row. For a Personal Training lump row, something like a period session count instead (confirmed empirically: 49 for a whole month, not literal students) -- never comparable across row types. NULL for Hourly Pay rows.';


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    auth_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pos_card_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_card_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid,
    stripe_account_id text NOT NULL,
    livemode boolean NOT NULL,
    payment_intent_id text,
    stripe_customer_id text,
    stripe_payment_method_id text,
    amount_cents integer NOT NULL,
    application_fee_cents integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sale_request jsonb NOT NULL,
    sale_id uuid,
    last_error text,
    refunded_cents integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    on_file_purpose text,
    source text DEFAULT 'pos'::text NOT NULL,
    stripe_reader_id text,
    CONSTRAINT pos_card_payments_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT pos_card_payments_on_file_purpose_check CHECK (((on_file_purpose IS NULL) OR (on_file_purpose = ANY (ARRAY['dues'::text, 'retail'::text])))),
    CONSTRAINT pos_card_payments_source_check CHECK ((source = ANY (ARRAY['pos'::text, 'online'::text]))),
    CONSTRAINT pos_card_payments_staff_check CHECK (((source = 'online'::text) OR (staff_id IS NOT NULL))),
    CONSTRAINT pos_card_payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'finalizing'::text, 'completed'::text, 'cancelled'::text, 'needs_attention'::text])))
);


--
-- Name: pos_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    kind text NOT NULL,
    source text DEFAULT 'mindbody'::text NOT NULL,
    mindbody_id text,
    name text NOT NULL,
    price_cents integer DEFAULT 0 NOT NULL,
    revenue_category_id uuid,
    taxable boolean,
    barcode text,
    image_url text,
    sessions integer,
    active boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    mindbody_name text,
    mindbody_price_cents integer,
    mindbody_tax_rate numeric(8,6),
    mindbody_group text,
    mindbody_discontinued boolean,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_staff_id uuid,
    package_parts jsonb,
    autopay_count integer,
    auto_renews boolean DEFAULT false NOT NULL,
    inventory_category_id uuid,
    open_price boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    members_only boolean DEFAULT false NOT NULL,
    par_level integer,
    reorder_level integer,
    agreement_template_id uuid,
    sell_online boolean DEFAULT false NOT NULL,
    CONSTRAINT pos_items_autopay_count_check CHECK (((autopay_count IS NULL) OR ((autopay_count >= 0) AND (autopay_count <= 120)))),
    CONSTRAINT pos_items_barcode_check CHECK (((barcode IS NULL) OR (char_length(barcode) <= 64))),
    CONSTRAINT pos_items_kind_check CHECK ((kind = ANY (ARRAY['product'::text, 'service'::text, 'membership'::text]))),
    CONSTRAINT pos_items_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200))),
    CONSTRAINT pos_items_par_level_check CHECK (((par_level IS NULL) OR ((par_level >= 0) AND (par_level <= 100000)))),
    CONSTRAINT pos_items_price_cents_check CHECK ((price_cents >= 0)),
    CONSTRAINT pos_items_reorder_level_check CHECK (((reorder_level IS NULL) OR ((reorder_level >= 0) AND (reorder_level <= 100000)))),
    CONSTRAINT pos_items_source_check CHECK ((source = ANY (ARRAY['mindbody'::text, 'synqiq'::text])))
);


--
-- Name: pos_sale_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_sale_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    pos_item_id uuid,
    name text NOT NULL,
    kind text NOT NULL,
    revenue_category_id uuid,
    revenue_category text,
    quantity integer NOT NULL,
    unit_price_cents integer NOT NULL,
    discount_cents integer DEFAULT 0 NOT NULL,
    taxable boolean NOT NULL,
    tax_cents integer DEFAULT 0 NOT NULL,
    total_cents integer NOT NULL,
    commission_credits jsonb DEFAULT '[]'::jsonb NOT NULL,
    no_commission boolean DEFAULT false NOT NULL,
    line_number integer NOT NULL,
    package_item_id uuid,
    package_name text,
    recurring boolean DEFAULT false NOT NULL,
    CONSTRAINT pos_sale_lines_quantity_check CHECK ((quantity > 0))
);


--
-- Name: pos_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    sale_number bigint NOT NULL,
    status text DEFAULT 'practice'::text NOT NULL,
    mindbody_client_id text,
    client_name text,
    staff_id uuid,
    subtotal_cents integer NOT NULL,
    discount_cents integer DEFAULT 0 NOT NULL,
    tax_cents integer DEFAULT 0 NOT NULL,
    total_cents integer NOT NULL,
    tax_rate numeric(8,6) NOT NULL,
    promo_code_id uuid,
    promo_code text,
    payment_method text DEFAULT 'practice'::text NOT NULL,
    payment_ref text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    voided_by_staff_id uuid,
    void_reason text,
    crm_contact_id uuid,
    source text DEFAULT 'pos'::text NOT NULL,
    CONSTRAINT pos_sales_source_check CHECK ((source = ANY (ARRAY['pos'::text, 'renewal'::text, 'online'::text]))),
    CONSTRAINT pos_sales_status_check CHECK ((status = ANY (ARRAY['practice'::text, 'completed'::text, 'voided'::text])))
);


--
-- Name: pos_sales_sale_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pos_sales ALTER COLUMN sale_number ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pos_sales_sale_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: practice_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    due_date date NOT NULL,
    subtotal_cents integer NOT NULL,
    tax_cents integer NOT NULL,
    total_cents integer NOT NULL,
    result text DEFAULT 'pending'::text NOT NULL,
    mindbody_sale_detail_id bigint,
    mindbody_total_cents integer,
    mindbody_charged_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_at timestamp with time zone,
    CONSTRAINT practice_charges_result_check CHECK ((result = ANY (ARRAY['pending'::text, 'match'::text, 'date_differs'::text, 'amount_differs'::text, 'not_charged'::text])))
);


--
-- Name: price_increase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_increase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    price_increase_id uuid NOT NULL,
    member_contract_id uuid,
    mindbody_client_contract_id bigint NOT NULL,
    mindbody_client_id text NOT NULL,
    contract_name text NOT NULL,
    original_start_date date,
    old_cents integer NOT NULL,
    new_cents integer NOT NULL,
    tax_rate numeric(8,6),
    CONSTRAINT price_increase_items_check CHECK ((new_cents >= old_cents)),
    CONSTRAINT price_increase_items_old_cents_check CHECK ((old_cents > 0)),
    CONSTRAINT price_increase_items_tax_rate_check CHECK (((tax_rate IS NULL) OR ((tax_rate >= (0)::numeric) AND (tax_rate < (1)::numeric))))
);


--
-- Name: price_increases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_increases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    percent numeric(5,2) NOT NULL,
    round_to_dollar boolean DEFAULT false NOT NULL,
    effective_on date NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    notice_subject text,
    notice_body text,
    member_count integer DEFAULT 0 NOT NULL,
    created_by_staff_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by_staff_id uuid,
    cancel_reason text,
    CONSTRAINT price_increases_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT price_increases_percent_check CHECK (((percent > (0)::numeric) AND (percent <= (100)::numeric)))
);


--
-- Name: promo_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code text NOT NULL,
    kind text NOT NULL,
    percent numeric(5,2),
    amount_cents integer,
    revenue_category_ids uuid[],
    starts_on date,
    ends_on date,
    max_uses integer,
    uses integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_staff_id uuid,
    CONSTRAINT promo_codes_amount_cents_check CHECK (((amount_cents IS NULL) OR (amount_cents > 0))),
    CONSTRAINT promo_codes_check CHECK ((((kind = 'percent'::text) AND (percent IS NOT NULL)) OR ((kind = 'amount'::text) AND (amount_cents IS NOT NULL)))),
    CONSTRAINT promo_codes_code_check CHECK ((code ~ '^[A-Z0-9_-]{2,30}$'::text)),
    CONSTRAINT promo_codes_kind_check CHECK ((kind = ANY (ARRAY['percent'::text, 'amount'::text]))),
    CONSTRAINT promo_codes_max_uses_check CHECK (((max_uses IS NULL) OR (max_uses > 0))),
    CONSTRAINT promo_codes_percent_check CHECK (((percent IS NULL) OR ((percent > (0)::numeric) AND (percent <= (100)::numeric))))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limit_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_counters (
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL
);


--
-- Name: rating_opt_outs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rating_opt_outs (
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rating_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rating_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    client_name text,
    staff_id uuid NOT NULL,
    class_occurrence_id uuid,
    class_name text NOT NULL,
    class_style text NOT NULL,
    class_start timestamp with time zone NOT NULL,
    quarter text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    skip_reason text,
    token_hash text,
    sent_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rating_requests_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'rated'::text, 'expired'::text, 'skipped'::text])))
);


--
-- Name: report_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    report_type text NOT NULL,
    uploaded_by_staff_id uuid NOT NULL,
    filename text NOT NULL,
    storage_path text NOT NULL,
    row_count integer NOT NULL,
    inserted_count integer DEFAULT 0 NOT NULL,
    duplicate_count integer DEFAULT 0 NOT NULL,
    status text NOT NULL,
    error_summary jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    warnings_summary jsonb,
    CONSTRAINT report_imports_report_type_check CHECK ((report_type = ANY (ARRAY['ratings_reviews'::text, 'revenue'::text, 'payroll'::text, 'mbo_autopay'::text]))),
    CONSTRAINT report_imports_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text])))
);


--
-- Name: COLUMN report_imports.warnings_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.report_imports.warnings_summary IS 'Non-blocking caveats on an otherwise-successful import (e.g. excluded uncapped row count, zero-revenue capped row count/list for revenue imports). Distinct from error_summary, which is only ever populated on status = ''failed''.';


--
-- Name: revenue_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    taxable boolean DEFAULT false NOT NULL,
    gl_account text,
    sort integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT revenue_categories_gl_account_check CHECK (((gl_account IS NULL) OR (char_length(gl_account) <= 40))),
    CONSTRAINT revenue_categories_key_check CHECK ((key ~ '^[a-z0-9_]{1,40}$'::text)),
    CONSTRAINT revenue_categories_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))
);


--
-- Name: revenue_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    import_batch_id uuid NOT NULL,
    row_hash text NOT NULL,
    date_of_service date NOT NULL,
    staff_id uuid,
    staff_name_raw text NOT NULL,
    client_name text NOT NULL,
    class_name text,
    service_category text,
    department_id uuid,
    pricing_option text,
    revenue_amount numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    visits_remaining integer NOT NULL
);


--
-- Name: COLUMN revenue_line_items.revenue_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.revenue_line_items.revenue_amount IS 'NULL = excluded from attribution (uncapped/unlimited plan). 0 = a real, trusted $0 from a capped plan (e.g. comp/promo) -- see warnings_summary on the owning report_imports row for a list to manually review. Never a derived/looked-up value -- always the source row''s own Rev. per Visit figure for capped rows.';


--
-- Name: COLUMN revenue_line_items.visits_remaining; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.revenue_line_items.visits_remaining IS 'Raw "Visits Rem." value from the source report. Under 1000 = a real fixed-count package (capped) -- trust revenue_amount as a real per-visit fact. Tens/hundreds of thousands = Mindbody''s placeholder for an uncapped/unlimited plan -- revenue_amount is NULL for these rows. See CAPPED_VISITS_THRESHOLD in lib/imports/definitions/revenue.ts.';


--
-- Name: room_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_layouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    room_id uuid NOT NULL,
    columns integer DEFAULT 8 NOT NULL,
    rows integer DEFAULT 6 NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    spot_noun text DEFAULT 'Spot'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_staff_id uuid,
    name text DEFAULT 'Main layout'::text NOT NULL,
    is_default boolean DEFAULT true NOT NULL,
    class_type_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    CONSTRAINT room_layouts_columns_check CHECK (((columns >= 2) AND (columns <= 30))),
    CONSTRAINT room_layouts_rows_check CHECK (((rows >= 2) AND (rows <= 30)))
);


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid,
    name text,
    active boolean DEFAULT true,
    mindbody_resource_id integer,
    organization_id uuid NOT NULL,
    synced_at timestamp with time zone,
    edits jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: COLUMN rooms.mindbody_resource_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rooms.mindbody_resource_id IS 'MindBody Resource.Id (GET /site/resources, also embedded as Classes[].Resource). Unique per resource.';


--
-- Name: sale_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_sale_id bigint NOT NULL,
    line_number integer NOT NULL,
    pricing_option_id bigint,
    description text,
    total_amount numeric,
    client_contract_id bigint
);


--
-- Name: sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mindbody_sale_id bigint NOT NULL,
    organization_id uuid NOT NULL,
    sales_rep_staff_id uuid,
    client_id text,
    sale_datetime timestamp with time zone NOT NULL,
    total_amount numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_pack_uses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_pack_uses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    session_pack_id uuid NOT NULL,
    trainer_session_id uuid,
    kind text NOT NULL,
    sessions integer NOT NULL,
    note text,
    staff_id uuid,
    voided_at timestamp with time zone,
    voided_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_pack_uses_kind_check CHECK ((kind = ANY (ARRAY['completed'::text, 'no_show'::text, 'late_cancel'::text, 'adjustment'::text, 'refund'::text]))),
    CONSTRAINT session_pack_uses_sessions_check CHECK ((sessions <> 0))
);


--
-- Name: session_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_client_id text,
    crm_contact_id uuid,
    name text NOT NULL,
    kind text NOT NULL,
    program text,
    total_sessions integer NOT NULL,
    opening_remaining integer NOT NULL,
    expires_on date,
    source text NOT NULL,
    mindbody_client_service_id text,
    pos_sale_id uuid,
    pos_item_id uuid,
    refreshed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_packs_check CHECK (((mindbody_client_id IS NOT NULL) OR (crm_contact_id IS NOT NULL))),
    CONSTRAINT session_packs_kind_check CHECK ((kind = ANY (ARRAY['pt'::text, 'intro'::text, 'class'::text]))),
    CONSTRAINT session_packs_opening_remaining_check CHECK ((opening_remaining >= 0)),
    CONSTRAINT session_packs_source_check CHECK ((source = ANY (ARRAY['mindbody'::text, 'synqiq'::text]))),
    CONSTRAINT session_packs_total_sessions_check CHECK ((total_sessions >= 0))
);


--
-- Name: session_pack_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.session_pack_balances WITH (security_invoker='true') AS
 SELECT id,
    organization_id,
    mindbody_client_id,
    crm_contact_id,
    name,
    kind,
    program,
    total_sessions,
    opening_remaining,
    expires_on,
    source,
    mindbody_client_service_id,
    pos_sale_id,
    pos_item_id,
    refreshed_at,
    created_at,
    (opening_remaining + COALESCE(( SELECT sum(u.sessions) AS sum
           FROM public.session_pack_uses u
          WHERE ((u.session_pack_id = p.id) AND (u.voided_at IS NULL))), (0)::bigint)) AS remaining
   FROM public.session_packs p;


--
-- Name: session_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_session_type_id integer NOT NULL,
    name text NOT NULL,
    kind text,
    default_minutes integer,
    mindbody_program_id integer,
    sessions_deducted integer,
    online_description text,
    available_online boolean,
    resource_required boolean,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    edits jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid,
    mindbody_staff_id bigint,
    first_name text NOT NULL,
    last_name text NOT NULL,
    display_name text NOT NULL,
    email text,
    phone text,
    active boolean NOT NULL,
    hire_date date,
    separation_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'staff'::text NOT NULL,
    auth_user_id uuid,
    title text,
    photo_url text,
    substitution_reminder_opt_out boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    can_sell boolean DEFAULT false NOT NULL,
    is_instructor boolean DEFAULT false NOT NULL,
    is_trainer boolean DEFAULT false NOT NULL,
    teaching_roles_set_at timestamp with time zone,
    is_facility_tech boolean DEFAULT false NOT NULL,
    CONSTRAINT staff_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'sales_lead'::text, 'sales'::text, 'staff'::text]))),
    CONSTRAINT staff_sales_role_sells CHECK (((role <> 'sales'::text) OR can_sell))
);


--
-- Name: COLUMN staff.substitution_reminder_opt_out; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.staff.substitution_reminder_opt_out IS 'Self-service opt-out from the every-4-days "still open" substitution reminder email. Does not affect the immediate email sent when a request is first created. Set via /api/staff/me/substitution-reminders, same admin-client self-edit pattern as display_name/title in /api/staff/me/profile -- staff has no RLS UPDATE policy at all.';


--
-- Name: COLUMN staff.archived_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.staff.archived_at IS 'Set by an admin from the Staff Logins page to hide a former instructor from the working list. Never set or cleared by the MindBody sync. Restorable (null again) from the Archived section.';


--
-- Name: COLUMN staff.can_sell; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.staff.can_sell IS 'Admin-editable: this staff member sells memberships (appears in the kiosk "Who are you meeting?" list and can see CRM data).';


--
-- Name: staff_pay_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_pay_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    scope text NOT NULL,
    mindbody_id bigint NOT NULL,
    label text,
    pay_rate_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_staff_id uuid,
    CONSTRAINT staff_pay_assignments_scope_check CHECK ((scope = ANY (ARRAY['class_schedule'::text, 'class_type'::text, 'session_type'::text])))
);


--
-- Name: staff_pay_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_pay_settings (
    staff_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    hourly_rate_cents integer,
    class_rate_id uuid,
    appointment_rate_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_staff_id uuid,
    commission_plan_id uuid,
    commission_enabled boolean,
    CONSTRAINT staff_pay_settings_hourly_rate_cents_check CHECK (((hourly_rate_cents IS NULL) OR (hourly_rate_cents >= 0)))
);


--
-- Name: staff_sync_exclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_sync_exclusions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    mindbody_staff_id integer NOT NULL,
    excluded_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stripe_connect_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_connect_events (
    id text NOT NULL,
    type text NOT NULL,
    stripe_account_id text,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stripe_connected_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_connected_accounts (
    organization_id uuid NOT NULL,
    stripe_account_id text NOT NULL,
    livemode boolean NOT NULL,
    card_payments_status text,
    ready boolean DEFAULT false NOT NULL,
    requirements_due text[] DEFAULT '{}'::text[] NOT NULL,
    display_name text,
    onboarding_started_at timestamp with time zone DEFAULT now() NOT NULL,
    ready_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    created_by_staff_id uuid
);


--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_events (
    id text NOT NULL,
    type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: studio_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studio_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    checkout_session_id text,
    name text NOT NULL,
    timezone text NOT NULL,
    mindbody_site_id integer,
    modules text[] NOT NULL,
    owner_first_name text NOT NULL,
    owner_last_name text NOT NULL,
    owner_email text NOT NULL,
    terms_accepted_at timestamp with time zone NOT NULL,
    organization_id uuid,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    provisioned_at timestamp with time zone,
    CONSTRAINT studio_signups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'provisioning'::text, 'provisioned'::text, 'failed'::text])))
);


--
-- Name: substitution_interests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.substitution_interests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    responded_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'interested'::text NOT NULL,
    CONSTRAINT substitution_interests_status_check CHECK ((status = ANY (ARRAY['interested'::text, 'declined'::text])))
);


--
-- Name: TABLE substitution_interests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.substitution_interests IS 'Which staff responded to a given substitution_requests row, and how (interested or declined). UNIQUE(request_id, staff_id) makes responding idempotent for a repeated identical response; a differing second response is rejected at the application layer (first response is locked in, not silently overwritten).';


--
-- Name: substitution_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.substitution_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurrence_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    last_reminder_sent_at timestamp with time zone,
    approved_by uuid,
    approved_staff_id uuid,
    CONSTRAINT substitution_requests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'pending_selection'::text, 'approved'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE substitution_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.substitution_requests IS 'A request to cover a specific class_occurrences row. One occurrence may have multiple requests over time (e.g. re-opened after a cancelled approval), so no uniqueness constraint on occurrence_id.';


--
-- Name: COLUMN substitution_requests.last_reminder_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.substitution_requests.last_reminder_sent_at IS 'When the last every-4-days reminder email went out for this request. NULL means never (the immediate day-1 email at creation is separate and does not set this). Reminder job compares now() against GREATEST(created_at, last_reminder_sent_at) + 4 days.';


--
-- Name: COLUMN substitution_requests.approved_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.substitution_requests.approved_by IS 'Admin who approved the substitute. Null for approvals made before this column existed.';


--
-- Name: COLUMN substitution_requests.approved_staff_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.substitution_requests.approved_staff_id IS 'Instructor who covered the class. Source of truth for "picked up as sub"; the Mindbody sync never writes this table.';


--
-- Name: sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_state (
    organization_id uuid NOT NULL,
    sync_name text NOT NULL,
    last_run_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_status text,
    last_error text,
    last_result jsonb,
    CONSTRAINT sync_state_last_status_check CHECK ((last_status = ANY (ARRAY['running'::text, 'success'::text, 'error'::text])))
);


--
-- Name: terminal_readers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminal_readers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    livemode boolean NOT NULL,
    stripe_account_id text NOT NULL,
    stripe_location_id text NOT NULL,
    stripe_reader_id text NOT NULL,
    label text NOT NULL,
    device_type text,
    serial_number text,
    registered_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone
);


--
-- Name: time_punch_edits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_punch_edits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    punch_id uuid NOT NULL,
    edited_by_staff_id uuid NOT NULL,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT time_punch_edits_action_check CHECK ((action = ANY (ARRAY['add'::text, 'edit'::text, 'delete'::text])))
);


--
-- Name: time_punches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_punches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    clock_in_at timestamp with time zone NOT NULL,
    clock_out_at timestamp with time zone,
    source text DEFAULT 'clock'::text NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT time_punches_check CHECK (((clock_out_at IS NULL) OR (clock_out_at > clock_in_at))),
    CONSTRAINT time_punches_source_check CHECK ((source = ANY (ARRAY['clock'::text, 'admin'::text])))
);


--
-- Name: trainer_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    source text NOT NULL,
    mindbody_availability_id bigint,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    session_type_ids integer[],
    created_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT trainer_availability_check CHECK ((ends_at > starts_at)),
    CONSTRAINT trainer_availability_source_check CHECK ((source = ANY (ARRAY['mindbody'::text, 'synqiq'::text])))
);


--
-- Name: trainer_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    trainer_staff_id uuid NOT NULL,
    mindbody_client_id text NOT NULL,
    client_name text NOT NULL,
    session_type_id integer,
    session_type_name text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    local_date date NOT NULL,
    status text DEFAULT 'booked'::text NOT NULL,
    coverage_kind text DEFAULT 'none'::text NOT NULL,
    coverage_name text,
    mindbody_client_service_id bigint,
    note text,
    booked_at timestamp with time zone DEFAULT now() NOT NULL,
    booked_by_staff_id uuid,
    closed_at timestamp with time zone,
    closed_by_staff_id uuid,
    cancel_reason text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    session_pack_id uuid,
    CONSTRAINT trainer_sessions_check CHECK ((ends_at > starts_at)),
    CONSTRAINT trainer_sessions_coverage_kind_check CHECK ((coverage_kind = ANY (ARRAY['pack'::text, 'none'::text]))),
    CONSTRAINT trainer_sessions_status_check CHECK ((status = ANY (ARRAY['booked'::text, 'completed'::text, 'no_show'::text, 'cancelled'::text, 'late_cancelled'::text])))
);


--
-- Name: waiver_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waiver_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    visit_id uuid,
    template_id uuid NOT NULL,
    template_version integer NOT NULL,
    template_sha256 text NOT NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    signer_ip text,
    signer_user_agent text,
    typed_name text NOT NULL,
    agreed boolean NOT NULL,
    is_minor boolean DEFAULT false NOT NULL,
    guardian_name text,
    signature_path text NOT NULL,
    guardian_signature_path text,
    pdf_path text NOT NULL,
    pdf_sha256 text NOT NULL,
    kiosk_device_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT waiver_signatures_agreed_check CHECK (agreed),
    CONSTRAINT waiver_signatures_check CHECK (((NOT is_minor) OR ((guardian_name IS NOT NULL) AND (guardian_signature_path IS NOT NULL))))
);


--
-- Name: waiver_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waiver_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    version integer NOT NULL,
    body text NOT NULL,
    body_sha256 text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_staff_id uuid,
    CONSTRAINT waiver_templates_body_check CHECK ((char_length(body) > 0)),
    CONSTRAINT waiver_templates_version_check CHECK ((version > 0))
);


--
-- Name: Locations Locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Locations"
    ADD CONSTRAINT "Locations_pkey" PRIMARY KEY (id);


--
-- Name: agreement_signatures agreement_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_pkey PRIMARY KEY (id);


--
-- Name: agreement_templates agreement_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_templates
    ADD CONSTRAINT agreement_templates_pkey PRIMARY KEY (id);


--
-- Name: appointment_occurrences appointment_occurrences_org_mindbody_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_occurrences
    ADD CONSTRAINT appointment_occurrences_org_mindbody_appointment_id_key UNIQUE (organization_id, mindbody_appointment_id);


--
-- Name: appointment_occurrences appointment_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_occurrences
    ADD CONSTRAINT appointment_occurrences_pkey PRIMARY KEY (id);


--
-- Name: billing_adjustments billing_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_adjustments
    ADD CONSTRAINT billing_adjustments_pkey PRIMARY KEY (id);


--
-- Name: billing_cutover_rows billing_cutover_rows_organization_id_mindbody_client_contra_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_cutover_rows
    ADD CONSTRAINT billing_cutover_rows_organization_id_mindbody_client_contra_key UNIQUE (organization_id, mindbody_client_contract_id);


--
-- Name: billing_cutover_rows billing_cutover_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_cutover_rows
    ADD CONSTRAINT billing_cutover_rows_pkey PRIMARY KEY (id);


--
-- Name: billing_cutover_settings billing_cutover_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_cutover_settings
    ADD CONSTRAINT billing_cutover_settings_pkey PRIMARY KEY (organization_id);


--
-- Name: billing_overage_charges billing_overage_charges_organization_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_overage_charges
    ADD CONSTRAINT billing_overage_charges_organization_id_month_key UNIQUE (organization_id, month);


--
-- Name: billing_overage_charges billing_overage_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_overage_charges
    ADD CONSTRAINT billing_overage_charges_pkey PRIMARY KEY (id);


--
-- Name: billing_test_members billing_test_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_test_members
    ADD CONSTRAINT billing_test_members_pkey PRIMARY KEY (organization_id, mindbody_client_id);


--
-- Name: board_members board_members_board_id_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_members
    ADD CONSTRAINT board_members_board_id_staff_id_key UNIQUE (board_id, staff_id);


--
-- Name: board_members board_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_members
    ADD CONSTRAINT board_members_pkey PRIMARY KEY (id);


--
-- Name: board_messages board_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_messages
    ADD CONSTRAINT board_messages_pkey PRIMARY KEY (id);


--
-- Name: card_expiry_notices card_expiry_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_expiry_notices
    ADD CONSTRAINT card_expiry_notices_pkey PRIMARY KEY (id);


--
-- Name: card_expiry_notices card_expiry_notices_schedule_id_card_exp_month_card_exp_yea_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_expiry_notices
    ADD CONSTRAINT card_expiry_notices_schedule_id_card_exp_month_card_exp_yea_key UNIQUE (schedule_id, card_exp_month, card_exp_year, notice);


--
-- Name: card_update_links card_update_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_update_links
    ADD CONSTRAINT card_update_links_pkey PRIMARY KEY (id);


--
-- Name: card_update_links card_update_links_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_update_links
    ADD CONSTRAINT card_update_links_token_hash_key UNIQUE (token_hash);


--
-- Name: catalog_edits catalog_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_edits
    ADD CONSTRAINT catalog_edits_pkey PRIMARY KEY (id);


--
-- Name: check_ins check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_pkey PRIMARY KEY (id);


--
-- Name: class_bookings class_bookings_class_session_id_mindbody_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_class_session_id_mindbody_client_id_key UNIQUE (class_session_id, mindbody_client_id);


--
-- Name: class_bookings class_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_pkey PRIMARY KEY (id);


--
-- Name: class_occurrences class_occurrences_org_mindbody_occurrence_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_org_mindbody_occurrence_id_key UNIQUE (organization_id, mindbody_occurrence_id);


--
-- Name: class_occurrences class_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_pkey PRIMARY KEY (id);


--
-- Name: class_ratings class_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_ratings
    ADD CONSTRAINT class_ratings_pkey PRIMARY KEY (id);


--
-- Name: class_ratings class_ratings_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_ratings
    ADD CONSTRAINT class_ratings_request_id_key UNIQUE (request_id);


--
-- Name: class_schedules class_schedules_organization_id_mindbody_class_schedule_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_organization_id_mindbody_class_schedule_id_key UNIQUE (organization_id, mindbody_class_schedule_id);


--
-- Name: class_schedules class_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_pkey PRIMARY KEY (id);


--
-- Name: class_sessions class_sessions_class_schedule_id_local_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_class_schedule_id_local_date_key UNIQUE (class_schedule_id, local_date);


--
-- Name: class_sessions class_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_pkey PRIMARY KEY (id);


--
-- Name: class_templates class_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_templates
    ADD CONSTRAINT class_templates_pkey PRIMARY KEY (id);


--
-- Name: class_types class_types_organization_id_mindbody_class_description_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_types
    ADD CONSTRAINT class_types_organization_id_mindbody_class_description_id_key UNIQUE (organization_id, mindbody_class_description_id);


--
-- Name: class_types class_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_types
    ADD CONSTRAINT class_types_pkey PRIMARY KEY (id);


--
-- Name: class_visits_mindbody class_visits_organization_id_occurrence_id_client_mindbody__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_visits_mindbody
    ADD CONSTRAINT class_visits_organization_id_occurrence_id_client_mindbody__key UNIQUE (organization_id, occurrence_id, client_mindbody_unique_id);


--
-- Name: class_visits_mindbody class_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_visits_mindbody
    ADD CONSTRAINT class_visits_pkey PRIMARY KEY (id);


--
-- Name: clients clients_organization_id_mindbody_unique_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_organization_id_mindbody_unique_id_key UNIQUE (organization_id, mindbody_unique_id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: commission_items commission_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_items
    ADD CONSTRAINT commission_items_pkey PRIMARY KEY (organization_id, product_id);


--
-- Name: commission_lines commission_lines_organization_id_mindbody_sale_detail_id_st_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_lines
    ADD CONSTRAINT commission_lines_organization_id_mindbody_sale_detail_id_st_key UNIQUE (organization_id, mindbody_sale_detail_id, staff_id, kind);


--
-- Name: commission_lines commission_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_lines
    ADD CONSTRAINT commission_lines_pkey PRIMARY KEY (id);


--
-- Name: commission_plans commission_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_plans
    ADD CONSTRAINT commission_plans_pkey PRIMARY KEY (id);


--
-- Name: commission_rules commission_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules
    ADD CONSTRAINT commission_rules_pkey PRIMARY KEY (id);


--
-- Name: commission_rules commission_rules_plan_id_category_condition_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules
    ADD CONSTRAINT commission_rules_plan_id_category_condition_key UNIQUE (plan_id, category, condition);


--
-- Name: commission_sale_credits commission_sale_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_sale_credits
    ADD CONSTRAINT commission_sale_credits_pkey PRIMARY KEY (organization_id, mindbody_sale_detail_id, staff_id);


--
-- Name: commission_sale_flags commission_sale_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_sale_flags
    ADD CONSTRAINT commission_sale_flags_pkey PRIMARY KEY (organization_id, mindbody_sale_detail_id);


--
-- Name: crm_appointments crm_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_pkey PRIMARY KEY (id);


--
-- Name: crm_contacts crm_contacts_email_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_email_alias_key UNIQUE (email_alias);


--
-- Name: crm_contacts crm_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_pkey PRIMARY KEY (id);


--
-- Name: crm_import_batches crm_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_import_batches
    ADD CONSTRAINT crm_import_batches_pkey PRIMARY KEY (id);


--
-- Name: crm_imported_activity crm_imported_activity_organization_id_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_imported_activity
    ADD CONSTRAINT crm_imported_activity_organization_id_source_key_key UNIQUE (organization_id, source_key);


--
-- Name: crm_imported_activity crm_imported_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_imported_activity
    ADD CONSTRAINT crm_imported_activity_pkey PRIMARY KEY (id);


--
-- Name: crm_jobs crm_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_jobs
    ADD CONSTRAINT crm_jobs_pkey PRIMARY KEY (id);


--
-- Name: crm_kpi_targets crm_kpi_targets_organization_id_month_staff_id_metric_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_kpi_targets
    ADD CONSTRAINT crm_kpi_targets_organization_id_month_staff_id_metric_key UNIQUE NULLS NOT DISTINCT (organization_id, month, staff_id, metric);


--
-- Name: crm_kpi_targets crm_kpi_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_kpi_targets
    ADD CONSTRAINT crm_kpi_targets_pkey PRIMARY KEY (id);


--
-- Name: crm_lead_forms crm_lead_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_pkey PRIMARY KEY (id);


--
-- Name: crm_lead_forms crm_lead_forms_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_token_hash_key UNIQUE (token_hash);


--
-- Name: crm_marketing_sources crm_marketing_sources_organization_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_marketing_sources
    ADD CONSTRAINT crm_marketing_sources_organization_id_label_key UNIQUE (organization_id, label);


--
-- Name: crm_marketing_sources crm_marketing_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_marketing_sources
    ADD CONSTRAINT crm_marketing_sources_pkey PRIMARY KEY (id);


--
-- Name: crm_messages crm_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_pkey PRIMARY KEY (id);


--
-- Name: crm_notes crm_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_pkey PRIMARY KEY (id);


--
-- Name: crm_pending_matches crm_pending_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pending_matches
    ADD CONSTRAINT crm_pending_matches_pkey PRIMARY KEY (id);


--
-- Name: crm_spam_submissions crm_spam_submissions_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_spam_submissions
    ADD CONSTRAINT crm_spam_submissions_fingerprint_key UNIQUE (fingerprint);


--
-- Name: crm_spam_submissions crm_spam_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_spam_submissions
    ADD CONSTRAINT crm_spam_submissions_pkey PRIMARY KEY (id);


--
-- Name: department_categories department_categories_organization_id_department_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_categories
    ADD CONSTRAINT department_categories_organization_id_department_id_key UNIQUE (organization_id, department_id);


--
-- Name: department_categories department_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_categories
    ADD CONSTRAINT department_categories_pkey PRIMARY KEY (id);


--
-- Name: departments departments_org_mindbody_program_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_org_mindbody_program_id_key UNIQUE (organization_id, mindbody_program_id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: email_settings email_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_settings
    ADD CONSTRAINT email_settings_pkey PRIMARY KEY (organization_id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (organization_id, key);


--
-- Name: email_unsubscribes email_unsubscribes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribes
    ADD CONSTRAINT email_unsubscribes_pkey PRIMARY KEY (organization_id, email_normalized);


--
-- Name: fitness_goals fitness_goals_organization_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_goals
    ADD CONSTRAINT fitness_goals_organization_id_month_key UNIQUE (organization_id, month);


--
-- Name: fitness_goals fitness_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_goals
    ADD CONSTRAINT fitness_goals_pkey PRIMARY KEY (id);


--
-- Name: followup_conversations followup_conversations_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_conversations
    ADD CONSTRAINT followup_conversations_alias_key UNIQUE (alias);


--
-- Name: followup_conversations followup_conversations_organization_id_instructor_id_client_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_conversations
    ADD CONSTRAINT followup_conversations_organization_id_instructor_id_client_key UNIQUE (organization_id, instructor_id, client_id);


--
-- Name: followup_conversations followup_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_conversations
    ADD CONSTRAINT followup_conversations_pkey PRIMARY KEY (id);


--
-- Name: followup_messages followup_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_messages
    ADD CONSTRAINT followup_messages_pkey PRIMARY KEY (id);


--
-- Name: guest_visits guest_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_pkey PRIMARY KEY (id);


--
-- Name: included_item_grants included_item_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.included_item_grants
    ADD CONSTRAINT included_item_grants_pkey PRIMARY KEY (id);


--
-- Name: included_items included_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.included_items
    ADD CONSTRAINT included_items_pkey PRIMARY KEY (id);


--
-- Name: instructor_class_eligibility instructor_class_eligibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_class_eligibility
    ADD CONSTRAINT instructor_class_eligibility_pkey PRIMARY KEY (id);


--
-- Name: instructor_class_eligibility instructor_class_eligibility_staff_id_department_id_class_n_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_class_eligibility
    ADD CONSTRAINT instructor_class_eligibility_staff_id_department_id_class_n_key UNIQUE (staff_id, department_id, class_name);


--
-- Name: instructor_reviews instructor_reviews_organization_id_row_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_reviews
    ADD CONSTRAINT instructor_reviews_organization_id_row_hash_key UNIQUE (organization_id, row_hash);


--
-- Name: instructor_reviews instructor_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_reviews
    ADD CONSTRAINT instructor_reviews_pkey PRIMARY KEY (id);


--
-- Name: inventory_categories inventory_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_categories
    ADD CONSTRAINT inventory_categories_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: kiosk_devices kiosk_devices_activation_code_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_devices
    ADD CONSTRAINT kiosk_devices_activation_code_hash_key UNIQUE (activation_code_hash);


--
-- Name: kiosk_devices kiosk_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_devices
    ADD CONSTRAINT kiosk_devices_pkey PRIMARY KEY (id);


--
-- Name: kiosk_devices kiosk_devices_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_devices
    ADD CONSTRAINT kiosk_devices_token_hash_key UNIQUE (token_hash);


--
-- Name: kiosk_match_tokens kiosk_match_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_match_tokens
    ADD CONSTRAINT kiosk_match_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: Locations locations_org_mindbody_location_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Locations"
    ADD CONSTRAINT locations_org_mindbody_location_id_key UNIQUE (organization_id, mindbody_location_id);


--
-- Name: maintenance_equipment maintenance_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_equipment
    ADD CONSTRAINT maintenance_equipment_pkey PRIMARY KEY (id);


--
-- Name: maintenance_equipment maintenance_equipment_qr_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_equipment
    ADD CONSTRAINT maintenance_equipment_qr_token_key UNIQUE (qr_token);


--
-- Name: maintenance_events maintenance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_events
    ADD CONSTRAINT maintenance_events_pkey PRIMARY KEY (id);


--
-- Name: maintenance_issues maintenance_issues_email_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_issues
    ADD CONSTRAINT maintenance_issues_email_alias_key UNIQUE (email_alias);


--
-- Name: maintenance_issues maintenance_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_issues
    ADD CONSTRAINT maintenance_issues_pkey PRIMARY KEY (id);


--
-- Name: maintenance_media maintenance_media_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_media
    ADD CONSTRAINT maintenance_media_path_key UNIQUE (path);


--
-- Name: maintenance_media maintenance_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_media
    ADD CONSTRAINT maintenance_media_pkey PRIMARY KEY (id);


--
-- Name: maintenance_vendors maintenance_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_vendors
    ADD CONSTRAINT maintenance_vendors_pkey PRIMARY KEY (id);


--
-- Name: mbo_autopay_rows mbo_autopay_rows_organization_id_row_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mbo_autopay_rows
    ADD CONSTRAINT mbo_autopay_rows_organization_id_row_hash_key UNIQUE (organization_id, row_hash);


--
-- Name: mbo_autopay_rows mbo_autopay_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mbo_autopay_rows
    ADD CONSTRAINT mbo_autopay_rows_pkey PRIMARY KEY (id);


--
-- Name: member_accounts member_accounts_organization_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_accounts
    ADD CONSTRAINT member_accounts_organization_id_email_key UNIQUE (organization_id, email);


--
-- Name: member_accounts member_accounts_organization_id_mindbody_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_accounts
    ADD CONSTRAINT member_accounts_organization_id_mindbody_client_id_key UNIQUE (organization_id, mindbody_client_id);


--
-- Name: member_accounts member_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_accounts
    ADD CONSTRAINT member_accounts_pkey PRIMARY KEY (id);


--
-- Name: member_billing_schedules member_billing_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_billing_schedules
    ADD CONSTRAINT member_billing_schedules_pkey PRIMARY KEY (id);


--
-- Name: member_cards member_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_cards
    ADD CONSTRAINT member_cards_pkey PRIMARY KEY (organization_id, mindbody_client_id, livemode, purpose);


--
-- Name: member_contract_sync member_contract_sync_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_contract_sync
    ADD CONSTRAINT member_contract_sync_pkey PRIMARY KEY (organization_id, mindbody_client_id);


--
-- Name: member_contracts member_contracts_organization_id_mindbody_client_contract_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_contracts
    ADD CONSTRAINT member_contracts_organization_id_mindbody_client_contract_i_key UNIQUE (organization_id, mindbody_client_contract_id);


--
-- Name: member_contracts member_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_contracts
    ADD CONSTRAINT member_contracts_pkey PRIMARY KEY (id);


--
-- Name: member_id_counters member_id_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_id_counters
    ADD CONSTRAINT member_id_counters_pkey PRIMARY KEY (organization_id);


--
-- Name: member_personal_edits member_personal_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal_edits
    ADD CONSTRAINT member_personal_edits_pkey PRIMARY KEY (id);


--
-- Name: member_personal member_personal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal
    ADD CONSTRAINT member_personal_pkey PRIMARY KEY (organization_id, mindbody_client_id);


--
-- Name: member_profile_sync member_profile_sync_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile_sync
    ADD CONSTRAINT member_profile_sync_pkey PRIMARY KEY (organization_id, mindbody_client_id);


--
-- Name: member_sale_items member_sale_items_organization_id_mindbody_sale_detail_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sale_items
    ADD CONSTRAINT member_sale_items_organization_id_mindbody_sale_detail_id_key UNIQUE (organization_id, mindbody_sale_detail_id);


--
-- Name: member_sale_items member_sale_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sale_items
    ADD CONSTRAINT member_sale_items_pkey PRIMARY KEY (id);


--
-- Name: member_sales member_sales_organization_id_mindbody_sale_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sales
    ADD CONSTRAINT member_sales_organization_id_mindbody_sale_id_key UNIQUE (organization_id, mindbody_sale_id);


--
-- Name: member_sales member_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sales
    ADD CONSTRAINT member_sales_pkey PRIMARY KEY (id);


--
-- Name: member_services member_services_organization_id_mindbody_client_service_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_services
    ADD CONSTRAINT member_services_organization_id_mindbody_client_service_id_key UNIQUE (organization_id, mindbody_client_service_id);


--
-- Name: member_services member_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_services
    ADD CONSTRAINT member_services_pkey PRIMARY KEY (id);


--
-- Name: member_sessions member_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sessions
    ADD CONSTRAINT member_sessions_pkey PRIMARY KEY (id);


--
-- Name: member_sessions member_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sessions
    ADD CONSTRAINT member_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: member_tokens member_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_tokens
    ADD CONSTRAINT member_tokens_pkey PRIMARY KEY (id);


--
-- Name: member_tokens member_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_tokens
    ADD CONSTRAINT member_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: member_visits member_visits_organization_id_mindbody_visit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_visits
    ADD CONSTRAINT member_visits_organization_id_mindbody_visit_id_key UNIQUE (organization_id, mindbody_visit_id);


--
-- Name: member_visits member_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_visits
    ADD CONSTRAINT member_visits_pkey PRIMARY KEY (id);


--
-- Name: membership_charges membership_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_charges
    ADD CONSTRAINT membership_charges_pkey PRIMARY KEY (id);


--
-- Name: membership_charges membership_charges_schedule_id_due_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_charges
    ADD CONSTRAINT membership_charges_schedule_id_due_date_key UNIQUE (schedule_id, due_date);


--
-- Name: membership_plans membership_plans_organization_id_mindbody_contract_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_organization_id_mindbody_contract_id_key UNIQUE (organization_id, mindbody_contract_id);


--
-- Name: membership_plans membership_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_pkey PRIMARY KEY (id);


--
-- Name: message_boards message_boards_department_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_boards
    ADD CONSTRAINT message_boards_department_id_key UNIQUE (department_id);


--
-- Name: message_boards message_boards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_boards
    ADD CONSTRAINT message_boards_pkey PRIMARY KEY (id);


--
-- Name: message_boards message_boards_substitution_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_boards
    ADD CONSTRAINT message_boards_substitution_request_id_key UNIQUE (substitution_request_id);


--
-- Name: milestone_emails milestone_emails_organization_id_mindbody_client_id_class_c_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_emails
    ADD CONSTRAINT milestone_emails_organization_id_mindbody_client_id_class_c_key UNIQUE (organization_id, mindbody_client_id, class_count);


--
-- Name: milestone_emails milestone_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_emails
    ADD CONSTRAINT milestone_emails_pkey PRIMARY KEY (id);


--
-- Name: milestone_templates milestone_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_templates
    ADD CONSTRAINT milestone_templates_pkey PRIMARY KEY (organization_id, staff_id, milestone);


--
-- Name: mindbody_item_types mindbody_item_types_organization_id_kind_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mindbody_item_types
    ADD CONSTRAINT mindbody_item_types_organization_id_kind_name_key UNIQUE (organization_id, kind, name);


--
-- Name: mindbody_item_types mindbody_item_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mindbody_item_types
    ADD CONSTRAINT mindbody_item_types_pkey PRIMARY KEY (id);


--
-- Name: newsletter_recipients newsletter_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_recipients
    ADD CONSTRAINT newsletter_recipients_pkey PRIMARY KEY (id);


--
-- Name: newsletter_recipients newsletter_recipients_unsubscribe_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_recipients
    ADD CONSTRAINT newsletter_recipients_unsubscribe_token_hash_key UNIQUE (unsubscribe_token_hash);


--
-- Name: newsletters newsletters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT newsletters_pkey PRIMARY KEY (id);


--
-- Name: org_modules org_modules_organization_id_module_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_modules
    ADD CONSTRAINT org_modules_organization_id_module_key UNIQUE (organization_id, module);


--
-- Name: org_modules org_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_modules
    ADD CONSTRAINT org_modules_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_crm_sms_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_crm_sms_number_key UNIQUE (crm_sms_number);


--
-- Name: organizations organizations_mindbody_site_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_mindbody_site_id_key UNIQUE (mindbody_site_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_stripe_customer_id_key UNIQUE (stripe_customer_id);


--
-- Name: organizations organizations_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: pay_rates pay_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rates
    ADD CONSTRAINT pay_rates_pkey PRIMARY KEY (id);


--
-- Name: payment_disputes payment_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_disputes
    ADD CONSTRAINT payment_disputes_pkey PRIMARY KEY (id);


--
-- Name: payroll_events payroll_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_events
    ADD CONSTRAINT payroll_events_pkey PRIMARY KEY (id);


--
-- Name: payroll_line_items payroll_line_items_organization_id_row_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_line_items
    ADD CONSTRAINT payroll_line_items_organization_id_row_hash_key UNIQUE (organization_id, row_hash);


--
-- Name: payroll_line_items payroll_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_line_items
    ADD CONSTRAINT payroll_line_items_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (auth_user_id);


--
-- Name: pos_card_payments pos_card_payments_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_card_payments
    ADD CONSTRAINT pos_card_payments_payment_intent_id_key UNIQUE (payment_intent_id);


--
-- Name: pos_card_payments pos_card_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_card_payments
    ADD CONSTRAINT pos_card_payments_pkey PRIMARY KEY (id);


--
-- Name: pos_items pos_items_organization_id_kind_mindbody_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_items
    ADD CONSTRAINT pos_items_organization_id_kind_mindbody_id_key UNIQUE (organization_id, kind, mindbody_id);


--
-- Name: pos_items pos_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_items
    ADD CONSTRAINT pos_items_pkey PRIMARY KEY (id);


--
-- Name: pos_sale_lines pos_sale_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sale_lines
    ADD CONSTRAINT pos_sale_lines_pkey PRIMARY KEY (id);


--
-- Name: pos_sales pos_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT pos_sales_pkey PRIMARY KEY (id);


--
-- Name: practice_charges practice_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_charges
    ADD CONSTRAINT practice_charges_pkey PRIMARY KEY (id);


--
-- Name: practice_charges practice_charges_schedule_id_due_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_charges
    ADD CONSTRAINT practice_charges_schedule_id_due_date_key UNIQUE (schedule_id, due_date);


--
-- Name: price_increase_items price_increase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increase_items
    ADD CONSTRAINT price_increase_items_pkey PRIMARY KEY (id);


--
-- Name: price_increase_items price_increase_items_price_increase_id_mindbody_client_cont_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increase_items
    ADD CONSTRAINT price_increase_items_price_increase_id_mindbody_client_cont_key UNIQUE (price_increase_id, mindbody_client_contract_id);


--
-- Name: price_increases price_increases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increases
    ADD CONSTRAINT price_increases_pkey PRIMARY KEY (id);


--
-- Name: promo_codes promo_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_codes
    ADD CONSTRAINT promo_codes_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_counters rate_limit_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_counters
    ADD CONSTRAINT rate_limit_counters_pkey PRIMARY KEY (key, window_start);


--
-- Name: rating_opt_outs rating_opt_outs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_opt_outs
    ADD CONSTRAINT rating_opt_outs_pkey PRIMARY KEY (organization_id, mindbody_client_id);


--
-- Name: rating_requests rating_requests_organization_id_mindbody_client_id_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_requests
    ADD CONSTRAINT rating_requests_organization_id_mindbody_client_id_staff_id_key UNIQUE (organization_id, mindbody_client_id, staff_id, quarter);


--
-- Name: rating_requests rating_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_requests
    ADD CONSTRAINT rating_requests_pkey PRIMARY KEY (id);


--
-- Name: rating_requests rating_requests_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_requests
    ADD CONSTRAINT rating_requests_token_hash_key UNIQUE (token_hash);


--
-- Name: report_imports report_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_imports
    ADD CONSTRAINT report_imports_pkey PRIMARY KEY (id);


--
-- Name: revenue_categories revenue_categories_organization_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_categories
    ADD CONSTRAINT revenue_categories_organization_id_key_key UNIQUE (organization_id, key);


--
-- Name: revenue_categories revenue_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_categories
    ADD CONSTRAINT revenue_categories_pkey PRIMARY KEY (id);


--
-- Name: revenue_line_items revenue_line_items_organization_id_row_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_line_items
    ADD CONSTRAINT revenue_line_items_organization_id_row_hash_key UNIQUE (organization_id, row_hash);


--
-- Name: revenue_line_items revenue_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_line_items
    ADD CONSTRAINT revenue_line_items_pkey PRIMARY KEY (id);


--
-- Name: room_layouts room_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_layouts
    ADD CONSTRAINT room_layouts_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_org_mindbody_resource_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_org_mindbody_resource_id_key UNIQUE (organization_id, mindbody_resource_id);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: sale_items sale_items_organization_id_mindbody_sale_id_line_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_organization_id_mindbody_sale_id_line_number_key UNIQUE (organization_id, mindbody_sale_id, line_number);


--
-- Name: sale_items sale_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_pkey PRIMARY KEY (id);


--
-- Name: sales sales_org_mindbody_sale_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_org_mindbody_sale_id_key UNIQUE (organization_id, mindbody_sale_id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: session_pack_uses session_pack_uses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_pack_uses
    ADD CONSTRAINT session_pack_uses_pkey PRIMARY KEY (id);


--
-- Name: session_packs session_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_packs
    ADD CONSTRAINT session_packs_pkey PRIMARY KEY (id);


--
-- Name: session_types session_types_organization_id_mindbody_session_type_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_types
    ADD CONSTRAINT session_types_organization_id_mindbody_session_type_id_key UNIQUE (organization_id, mindbody_session_type_id);


--
-- Name: session_types session_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_types
    ADD CONSTRAINT session_types_pkey PRIMARY KEY (id);


--
-- Name: staff staff_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: staff staff_org_mindbody_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_org_mindbody_staff_id_key UNIQUE (organization_id, mindbody_staff_id);


--
-- Name: staff_pay_assignments staff_pay_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_assignments
    ADD CONSTRAINT staff_pay_assignments_pkey PRIMARY KEY (id);


--
-- Name: staff_pay_assignments staff_pay_assignments_staff_id_scope_mindbody_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_assignments
    ADD CONSTRAINT staff_pay_assignments_staff_id_scope_mindbody_id_key UNIQUE (staff_id, scope, mindbody_id);


--
-- Name: staff_pay_settings staff_pay_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_settings
    ADD CONSTRAINT staff_pay_settings_pkey PRIMARY KEY (staff_id);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: staff_sync_exclusions staff_sync_exclusions_organization_id_mindbody_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_sync_exclusions
    ADD CONSTRAINT staff_sync_exclusions_organization_id_mindbody_staff_id_key UNIQUE (organization_id, mindbody_staff_id);


--
-- Name: staff_sync_exclusions staff_sync_exclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_sync_exclusions
    ADD CONSTRAINT staff_sync_exclusions_pkey PRIMARY KEY (id);


--
-- Name: stripe_connect_events stripe_connect_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_connect_events
    ADD CONSTRAINT stripe_connect_events_pkey PRIMARY KEY (id);


--
-- Name: stripe_connected_accounts stripe_connected_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_connected_accounts
    ADD CONSTRAINT stripe_connected_accounts_pkey PRIMARY KEY (organization_id, livemode);


--
-- Name: stripe_connected_accounts stripe_connected_accounts_stripe_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_connected_accounts
    ADD CONSTRAINT stripe_connected_accounts_stripe_account_id_key UNIQUE (stripe_account_id);


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (id);


--
-- Name: studio_signups studio_signups_checkout_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_signups
    ADD CONSTRAINT studio_signups_checkout_session_id_key UNIQUE (checkout_session_id);


--
-- Name: studio_signups studio_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_signups
    ADD CONSTRAINT studio_signups_pkey PRIMARY KEY (id);


--
-- Name: substitution_interests substitution_interests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_interests
    ADD CONSTRAINT substitution_interests_pkey PRIMARY KEY (id);


--
-- Name: substitution_interests substitution_interests_request_id_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_interests
    ADD CONSTRAINT substitution_interests_request_id_staff_id_key UNIQUE (request_id, staff_id);


--
-- Name: substitution_requests substitution_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_pkey PRIMARY KEY (id);


--
-- Name: sync_state sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_state
    ADD CONSTRAINT sync_state_pkey PRIMARY KEY (organization_id, sync_name);


--
-- Name: terminal_readers terminal_readers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_readers
    ADD CONSTRAINT terminal_readers_pkey PRIMARY KEY (id);


--
-- Name: terminal_readers terminal_readers_stripe_reader_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_readers
    ADD CONSTRAINT terminal_readers_stripe_reader_id_key UNIQUE (stripe_reader_id);


--
-- Name: time_punch_edits time_punch_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_punch_edits
    ADD CONSTRAINT time_punch_edits_pkey PRIMARY KEY (id);


--
-- Name: time_punches time_punches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_punches
    ADD CONSTRAINT time_punches_pkey PRIMARY KEY (id);


--
-- Name: trainer_availability trainer_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability
    ADD CONSTRAINT trainer_availability_pkey PRIMARY KEY (id);


--
-- Name: trainer_sessions trainer_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_sessions
    ADD CONSTRAINT trainer_sessions_pkey PRIMARY KEY (id);


--
-- Name: waiver_signatures waiver_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_signatures
    ADD CONSTRAINT waiver_signatures_pkey PRIMARY KEY (id);


--
-- Name: waiver_templates waiver_templates_organization_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_templates
    ADD CONSTRAINT waiver_templates_organization_id_version_key UNIQUE (organization_id, version);


--
-- Name: waiver_templates waiver_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_templates
    ADD CONSTRAINT waiver_templates_pkey PRIMARY KEY (id);


--
-- Name: agreement_signatures_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agreement_signatures_client_idx ON public.agreement_signatures USING btree (organization_id, mindbody_client_id, signed_at DESC);


--
-- Name: agreement_signatures_sale_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agreement_signatures_sale_idx ON public.agreement_signatures USING btree (sale_id);


--
-- Name: agreement_templates_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agreement_templates_org_idx ON public.agreement_templates USING btree (organization_id);


--
-- Name: appointment_occurrences_org_staff_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_occurrences_org_staff_start_idx ON public.appointment_occurrences USING btree (organization_id, staff_id, start_datetime);


--
-- Name: billing_adjustments_cancel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_adjustments_cancel_idx ON public.billing_adjustments USING btree (organization_id, kind, reason_category) WHERE (kind = 'cancel'::text);


--
-- Name: billing_adjustments_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_adjustments_client_idx ON public.billing_adjustments USING btree (organization_id, mindbody_client_id);


--
-- Name: billing_cutover_rows_payer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_cutover_rows_payer_idx ON public.billing_cutover_rows USING btree (organization_id, payer_mindbody_client_id);


--
-- Name: card_update_links_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_update_links_client_idx ON public.card_update_links USING btree (organization_id, mindbody_client_id);


--
-- Name: catalog_edits_row_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_edits_row_idx ON public.catalog_edits USING btree (organization_id, entity, row_id, created_at DESC);


--
-- Name: check_ins_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX check_ins_client_idx ON public.check_ins USING btree (organization_id, mindbody_client_id, checked_in_at DESC);


--
-- Name: check_ins_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX check_ins_day_idx ON public.check_ins USING btree (organization_id, local_date DESC);


--
-- Name: check_ins_standing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX check_ins_standing_idx ON public.check_ins USING btree (organization_id, local_date, billing_standing);


--
-- Name: class_bookings_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_bookings_client_idx ON public.class_bookings USING btree (organization_id, mindbody_client_id);


--
-- Name: class_bookings_fees_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_bookings_fees_idx ON public.class_bookings USING btree (organization_id, status) WHERE (status = ANY (ARRAY['no_show'::text, 'late_cancelled'::text]));


--
-- Name: class_bookings_mindbody_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_bookings_mindbody_pending_idx ON public.class_bookings USING btree (organization_id) WHERE (mindbody_sync_status = 'pending'::text);


--
-- Name: class_bookings_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_bookings_session_idx ON public.class_bookings USING btree (class_session_id, status);


--
-- Name: class_bookings_spot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX class_bookings_spot_idx ON public.class_bookings USING btree (class_session_id, spot_id) WHERE ((spot_id IS NOT NULL) AND (status = ANY (ARRAY['booked'::text, 'checked_in'::text])));


--
-- Name: class_occurrences_class_session_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX class_occurrences_class_session_key ON public.class_occurrences USING btree (class_session_id);


--
-- Name: class_occurrences_followup_reminder_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_occurrences_followup_reminder_due_idx ON public.class_occurrences USING btree (end_datetime) WHERE (followup_reminder_sent_at IS NULL);


--
-- Name: class_ratings_quarter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_ratings_quarter_idx ON public.class_ratings USING btree (organization_id, quarter);


--
-- Name: class_ratings_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_ratings_staff_idx ON public.class_ratings USING btree (organization_id, staff_id, quarter);


--
-- Name: class_schedules_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_schedules_type_idx ON public.class_schedules USING btree (organization_id, mindbody_class_description_id);


--
-- Name: class_sessions_assistant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_sessions_assistant_idx ON public.class_sessions USING btree (organization_id, assistant_staff_id) WHERE (assistant_staff_id IS NOT NULL);


--
-- Name: class_sessions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_sessions_date_idx ON public.class_sessions USING btree (organization_id, local_date);


--
-- Name: class_sessions_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_sessions_staff_idx ON public.class_sessions USING btree (organization_id, staff_id) WHERE (staff_id IS NOT NULL);


--
-- Name: class_sessions_starts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_sessions_starts_idx ON public.class_sessions USING btree (organization_id, starts_at);


--
-- Name: class_visits_occurrence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_visits_occurrence_idx ON public.class_visits_mindbody USING btree (occurrence_id);


--
-- Name: class_visits_org_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_visits_org_client_idx ON public.class_visits_mindbody USING btree (organization_id, client_mindbody_unique_id);


--
-- Name: clients_org_mindbody_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_org_mindbody_client_id_idx ON public.clients USING btree (organization_id, mindbody_client_id);


--
-- Name: clients_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_org_status_idx ON public.clients USING btree (organization_id, status);


--
-- Name: commission_lines_org_earned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commission_lines_org_earned_idx ON public.commission_lines USING btree (organization_id, earned_at);


--
-- Name: commission_lines_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commission_lines_staff_idx ON public.commission_lines USING btree (organization_id, staff_id, earned_at);


--
-- Name: commission_sale_credits_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commission_sale_credits_staff_idx ON public.commission_sale_credits USING btree (organization_id, staff_id);


--
-- Name: crm_appointments_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_appointments_contact_idx ON public.crm_appointments USING btree (contact_id);


--
-- Name: crm_appointments_org_scheduled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_appointments_org_scheduled_idx ON public.crm_appointments USING btree (organization_id, scheduled_at);


--
-- Name: crm_contacts_external_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_external_ref_idx ON public.crm_contacts USING btree (organization_id, external_ref);


--
-- Name: crm_contacts_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_import_batch_idx ON public.crm_contacts USING btree (import_batch_id);


--
-- Name: crm_contacts_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_org_created_idx ON public.crm_contacts USING btree (organization_id, created_at DESC);


--
-- Name: crm_contacts_org_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_org_email_idx ON public.crm_contacts USING btree (organization_id, email_normalized);


--
-- Name: crm_contacts_org_enrolled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_org_enrolled_idx ON public.crm_contacts USING btree (organization_id, member_enrolled_at DESC) WHERE (member_enrolled_at IS NOT NULL);


--
-- Name: crm_contacts_org_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_org_live_idx ON public.crm_contacts USING btree (organization_id) WHERE ((deleted_at IS NULL) AND (merged_into_id IS NULL));


--
-- Name: crm_contacts_org_mindbody_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_org_mindbody_client_idx ON public.crm_contacts USING btree (organization_id, mindbody_client_id);


--
-- Name: crm_contacts_org_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_org_phone_idx ON public.crm_contacts USING btree (organization_id, phone_e164);


--
-- Name: crm_contacts_trainer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_trainer_idx ON public.crm_contacts USING btree (trainer_staff_id) WHERE (trainer_staff_id IS NOT NULL);


--
-- Name: crm_contacts_warm_pool_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_warm_pool_idx ON public.crm_contacts USING btree (organization_id, warm_pool_at) WHERE (warm_pool_at IS NOT NULL);


--
-- Name: crm_imported_activity_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_imported_activity_batch_idx ON public.crm_imported_activity USING btree (import_batch_id);


--
-- Name: crm_imported_activity_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_imported_activity_contact_idx ON public.crm_imported_activity USING btree (contact_id, occurred_at);


--
-- Name: crm_jobs_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_jobs_due_idx ON public.crm_jobs USING btree (next_run_at) WHERE (status = 'queued'::text);


--
-- Name: crm_kpi_targets_org_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_kpi_targets_org_month_idx ON public.crm_kpi_targets USING btree (organization_id, month);


--
-- Name: crm_lead_forms_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_lead_forms_org_idx ON public.crm_lead_forms USING btree (organization_id);


--
-- Name: crm_messages_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_contact_idx ON public.crm_messages USING btree (contact_id, created_at);


--
-- Name: crm_messages_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_provider_idx ON public.crm_messages USING btree (provider_message_id);


--
-- Name: crm_messages_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_unread_idx ON public.crm_messages USING btree (organization_id, created_at DESC) WHERE ((direction = 'inbound'::text) AND (read_at IS NULL));


--
-- Name: crm_notes_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_notes_contact_idx ON public.crm_notes USING btree (contact_id, created_at DESC);


--
-- Name: crm_pending_matches_org_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_pending_matches_org_open_idx ON public.crm_pending_matches USING btree (organization_id) WHERE (status = 'open'::text);


--
-- Name: crm_spam_submissions_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_spam_submissions_org_idx ON public.crm_spam_submissions USING btree (organization_id, created_at DESC);


--
-- Name: followup_conversations_org_instructor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX followup_conversations_org_instructor_idx ON public.followup_conversations USING btree (organization_id, instructor_id);


--
-- Name: followup_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX followup_messages_conversation_idx ON public.followup_messages USING btree (conversation_id, created_at);


--
-- Name: guest_visits_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guest_visits_contact_idx ON public.guest_visits USING btree (contact_id);


--
-- Name: guest_visits_org_visit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guest_visits_org_visit_idx ON public.guest_visits USING btree (organization_id, visit_at DESC);


--
-- Name: included_item_grants_pos_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX included_item_grants_pos_key ON public.included_item_grants USING btree (organization_id, item_id, pos_item_id);


--
-- Name: included_item_grants_product_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX included_item_grants_product_key ON public.included_item_grants USING btree (organization_id, item_id, mindbody_product_id);


--
-- Name: included_items_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX included_items_name_key ON public.included_items USING btree (organization_id, lower(name));


--
-- Name: inventory_categories_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_categories_org_idx ON public.inventory_categories USING btree (organization_id, parent_id, sort);


--
-- Name: inventory_movements_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_movements_item_idx ON public.inventory_movements USING btree (pos_item_id, created_at);


--
-- Name: inventory_movements_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_movements_org_idx ON public.inventory_movements USING btree (organization_id, created_at);


--
-- Name: maintenance_equipment_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_equipment_org_idx ON public.maintenance_equipment USING btree (organization_id);


--
-- Name: maintenance_events_issue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_events_issue_idx ON public.maintenance_events USING btree (issue_id, created_at);


--
-- Name: maintenance_issues_equipment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_issues_equipment_idx ON public.maintenance_issues USING btree (equipment_id);


--
-- Name: maintenance_issues_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_issues_org_status_idx ON public.maintenance_issues USING btree (organization_id, status);


--
-- Name: maintenance_media_issue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_media_issue_idx ON public.maintenance_media USING btree (issue_id);


--
-- Name: maintenance_vendors_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_vendors_org_idx ON public.maintenance_vendors USING btree (organization_id);


--
-- Name: mbo_autopay_rows_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mbo_autopay_rows_client_idx ON public.mbo_autopay_rows USING btree (organization_id, mindbody_client_id);


--
-- Name: mbo_autopay_rows_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mbo_autopay_rows_date_idx ON public.mbo_autopay_rows USING btree (organization_id, charge_date);


--
-- Name: member_billing_schedules_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_billing_schedules_client_idx ON public.member_billing_schedules USING btree (organization_id, mindbody_client_id);


--
-- Name: member_billing_schedules_mindbody_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_billing_schedules_mindbody_contract_idx ON public.member_billing_schedules USING btree (organization_id, mindbody_client_contract_id) WHERE (source = 'mindbody'::text);


--
-- Name: member_billing_schedules_sale_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_billing_schedules_sale_idx ON public.member_billing_schedules USING btree (sale_id);


--
-- Name: member_contracts_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_contracts_client_idx ON public.member_contracts USING btree (organization_id, mindbody_client_id);


--
-- Name: member_contracts_next_bill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_contracts_next_bill_idx ON public.member_contracts USING btree (organization_id, next_bill_date);


--
-- Name: member_contracts_original_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_contracts_original_start_idx ON public.member_contracts USING btree (organization_id, original_start_date);


--
-- Name: member_personal_edits_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_personal_edits_client_idx ON public.member_personal_edits USING btree (organization_id, mindbody_client_id, created_at DESC);


--
-- Name: member_personal_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_personal_phone_idx ON public.member_personal USING btree (organization_id, phone_digits);


--
-- Name: member_sale_items_sale_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_sale_items_sale_idx ON public.member_sale_items USING btree (organization_id, mindbody_sale_id);


--
-- Name: member_sales_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_sales_client_idx ON public.member_sales USING btree (organization_id, mindbody_client_id, sale_at DESC);


--
-- Name: member_services_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_services_client_idx ON public.member_services USING btree (organization_id, mindbody_client_id);


--
-- Name: member_sessions_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_sessions_account_idx ON public.member_sessions USING btree (account_id);


--
-- Name: member_tokens_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_tokens_account_idx ON public.member_tokens USING btree (account_id, created_at DESC);


--
-- Name: member_visits_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_visits_client_idx ON public.member_visits USING btree (organization_id, mindbody_client_id, start_local DESC);


--
-- Name: membership_charges_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_charges_client_idx ON public.membership_charges USING btree (organization_id, mindbody_client_id, due_date);


--
-- Name: membership_charges_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_charges_due_idx ON public.membership_charges USING btree (organization_id, status, next_attempt_on);


--
-- Name: message_boards_one_announcements_per_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX message_boards_one_announcements_per_org ON public.message_boards USING btree (organization_id) WHERE (board_type = 'announcements'::text);


--
-- Name: message_boards_one_team_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX message_boards_one_team_board_idx ON public.message_boards USING btree (organization_id, board_type) WHERE (board_type = ANY (ARRAY['team_sales'::text, 'team_trainers'::text]));


--
-- Name: milestone_emails_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX milestone_emails_staff_idx ON public.milestone_emails USING btree (organization_id, staff_id, status, created_at DESC);


--
-- Name: newsletter_recipients_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX newsletter_recipients_email_idx ON public.newsletter_recipients USING btree (newsletter_id, lower(email));


--
-- Name: newsletters_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX newsletters_due_idx ON public.newsletters USING btree (scheduled_for) WHERE (status = 'scheduled'::text);


--
-- Name: newsletters_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX newsletters_org_idx ON public.newsletters USING btree (organization_id, created_at DESC);


--
-- Name: organizations_email_relay_domain_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organizations_email_relay_domain_key ON public.organizations USING btree (email_relay_domain) WHERE (email_relay_domain IS NOT NULL);


--
-- Name: pay_rates_org_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pay_rates_org_name_idx ON public.pay_rates USING btree (organization_id, lower(name)) WHERE (archived_at IS NULL);


--
-- Name: payment_disputes_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_disputes_org_idx ON public.payment_disputes USING btree (organization_id, created_at DESC);


--
-- Name: payroll_events_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_events_date_idx ON public.payroll_events USING btree (organization_id, work_date);


--
-- Name: payroll_events_session_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payroll_events_session_live_idx ON public.payroll_events USING btree (trainer_session_id) WHERE (voided_at IS NULL);


--
-- Name: payroll_events_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_events_staff_idx ON public.payroll_events USING btree (organization_id, staff_id, work_date);


--
-- Name: payroll_line_items_org_staff_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_line_items_org_staff_date_idx ON public.payroll_line_items USING btree (organization_id, staff_id, class_date);


--
-- Name: pos_card_payments_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_card_payments_org_idx ON public.pos_card_payments USING btree (organization_id, created_at DESC);


--
-- Name: pos_card_payments_sale_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_card_payments_sale_idx ON public.pos_card_payments USING btree (sale_id);


--
-- Name: pos_items_barcode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_items_barcode_idx ON public.pos_items USING btree (organization_id, barcode) WHERE (barcode IS NOT NULL);


--
-- Name: pos_items_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_items_org_idx ON public.pos_items USING btree (organization_id, active, revenue_category_id);


--
-- Name: pos_sale_lines_sale_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_sale_lines_sale_idx ON public.pos_sale_lines USING btree (sale_id);


--
-- Name: pos_sales_crm_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_sales_crm_contact_idx ON public.pos_sales USING btree (crm_contact_id) WHERE (crm_contact_id IS NOT NULL);


--
-- Name: pos_sales_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_sales_org_created_idx ON public.pos_sales USING btree (organization_id, created_at DESC);


--
-- Name: practice_charges_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_charges_client_idx ON public.practice_charges USING btree (organization_id, mindbody_client_id, due_date);


--
-- Name: price_increase_items_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_increase_items_client_idx ON public.price_increase_items USING btree (organization_id, mindbody_client_id);


--
-- Name: price_increase_items_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_increase_items_contract_idx ON public.price_increase_items USING btree (organization_id, mindbody_client_contract_id);


--
-- Name: promo_codes_org_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX promo_codes_org_code_idx ON public.promo_codes USING btree (organization_id, code) WHERE active;


--
-- Name: rating_requests_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rating_requests_client_idx ON public.rating_requests USING btree (organization_id, mindbody_client_id, sent_at);


--
-- Name: rating_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rating_requests_status_idx ON public.rating_requests USING btree (organization_id, status, class_start);


--
-- Name: room_layouts_one_default_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX room_layouts_one_default_idx ON public.room_layouts USING btree (room_id) WHERE is_default;


--
-- Name: room_layouts_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_layouts_org_idx ON public.room_layouts USING btree (organization_id);


--
-- Name: room_layouts_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_layouts_room_idx ON public.room_layouts USING btree (room_id);


--
-- Name: sale_items_org_sale_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_items_org_sale_idx ON public.sale_items USING btree (organization_id, mindbody_sale_id);


--
-- Name: sales_org_rep_datetime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_org_rep_datetime_idx ON public.sales USING btree (organization_id, sales_rep_staff_id, sale_datetime);


--
-- Name: session_pack_uses_pack_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_pack_uses_pack_idx ON public.session_pack_uses USING btree (session_pack_id) WHERE (voided_at IS NULL);


--
-- Name: session_pack_uses_session_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX session_pack_uses_session_key ON public.session_pack_uses USING btree (trainer_session_id) WHERE ((trainer_session_id IS NOT NULL) AND (voided_at IS NULL));


--
-- Name: session_packs_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_packs_client_idx ON public.session_packs USING btree (organization_id, mindbody_client_id);


--
-- Name: session_packs_mindbody_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX session_packs_mindbody_key ON public.session_packs USING btree (organization_id, mindbody_client_service_id);


--
-- Name: staff_pay_assignments_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_pay_assignments_org_idx ON public.staff_pay_assignments USING btree (organization_id, staff_id);


--
-- Name: staff_pay_settings_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_pay_settings_org_idx ON public.staff_pay_settings USING btree (organization_id);


--
-- Name: terminal_readers_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX terminal_readers_org_idx ON public.terminal_readers USING btree (organization_id, livemode) WHERE (removed_at IS NULL);


--
-- Name: time_punch_edits_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_punch_edits_org_idx ON public.time_punch_edits USING btree (organization_id, created_at DESC);


--
-- Name: time_punches_one_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX time_punches_one_open_idx ON public.time_punches USING btree (staff_id) WHERE ((clock_out_at IS NULL) AND (deleted_at IS NULL));


--
-- Name: time_punches_org_in_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_punches_org_in_idx ON public.time_punches USING btree (organization_id, clock_in_at);


--
-- Name: trainer_availability_mindbody_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trainer_availability_mindbody_idx ON public.trainer_availability USING btree (organization_id, mindbody_availability_id, starts_at) WHERE (source = 'mindbody'::text);


--
-- Name: trainer_availability_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainer_availability_staff_idx ON public.trainer_availability USING btree (organization_id, staff_id, starts_at);


--
-- Name: trainer_sessions_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainer_sessions_client_idx ON public.trainer_sessions USING btree (organization_id, mindbody_client_id);


--
-- Name: trainer_sessions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainer_sessions_date_idx ON public.trainer_sessions USING btree (organization_id, local_date);


--
-- Name: trainer_sessions_trainer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainer_sessions_trainer_idx ON public.trainer_sessions USING btree (organization_id, trainer_staff_id, starts_at);


--
-- Name: waiver_signatures_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waiver_signatures_contact_idx ON public.waiver_signatures USING btree (contact_id);


--
-- Name: waiver_templates_one_active_per_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waiver_templates_one_active_per_org ON public.waiver_templates USING btree (organization_id) WHERE is_active;


--
-- Name: class_bookings class_bookings_mark_for_mindbody; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER class_bookings_mark_for_mindbody BEFORE INSERT OR UPDATE OF status ON public.class_bookings FOR EACH ROW EXECUTE FUNCTION private.mark_booking_for_mindbody();


--
-- Name: class_bookings class_bookings_signed_in_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER class_bookings_signed_in_changed AFTER INSERT OR DELETE OR UPDATE OF status ON public.class_bookings FOR EACH ROW EXECUTE FUNCTION private.booking_signed_in_changed();


--
-- Name: organizations create_announcements_board_for_org_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_announcements_board_for_org_trigger AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.create_announcements_board_for_org();


--
-- Name: class_occurrences create_department_board_on_first_occurrence_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_department_board_on_first_occurrence_trigger AFTER INSERT OR UPDATE ON public.class_occurrences FOR EACH ROW WHEN (((new.department_id IS NOT NULL) AND (new.mindbody_occurrence_id IS NOT NULL))) EXECUTE FUNCTION private.create_department_board_on_first_occurrence();


--
-- Name: crm_appointments crm_appointments_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_appointments_no_delete BEFORE DELETE ON public.crm_appointments FOR EACH ROW EXECUTE FUNCTION private.prevent_delete();


--
-- Name: crm_contacts crm_contacts_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_contacts_no_delete BEFORE DELETE ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION private.prevent_delete();


--
-- Name: crm_messages crm_messages_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_messages_immutable BEFORE UPDATE ON public.crm_messages FOR EACH ROW EXECUTE FUNCTION private.crm_messages_immutable();


--
-- Name: crm_messages crm_messages_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_messages_no_delete BEFORE DELETE ON public.crm_messages FOR EACH ROW EXECUTE FUNCTION private.prevent_delete();


--
-- Name: crm_notes crm_notes_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_notes_immutable BEFORE UPDATE ON public.crm_notes FOR EACH ROW EXECUTE FUNCTION private.crm_notes_immutable();


--
-- Name: crm_notes crm_notes_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_notes_no_delete BEFORE DELETE ON public.crm_notes FOR EACH ROW EXECUTE FUNCTION private.prevent_delete();


--
-- Name: organizations organizations_create_team_boards; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_create_team_boards AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.create_team_boards_for_org();


--
-- Name: board_members prevent_board_members_hard_delete_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_board_members_hard_delete_trigger BEFORE DELETE ON public.board_members FOR EACH ROW EXECUTE FUNCTION private.prevent_board_members_hard_delete();


--
-- Name: instructor_class_eligibility sync_department_board_membership_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_department_board_membership_trigger AFTER INSERT OR DELETE OR UPDATE ON public.instructor_class_eligibility FOR EACH ROW EXECUTE FUNCTION private.sync_department_board_membership();


--
-- Name: waiver_signatures waiver_signatures_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waiver_signatures_immutable BEFORE UPDATE ON public.waiver_signatures FOR EACH ROW EXECUTE FUNCTION private.waiver_signatures_immutable();


--
-- Name: waiver_signatures waiver_signatures_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waiver_signatures_no_delete BEFORE DELETE ON public.waiver_signatures FOR EACH ROW EXECUTE FUNCTION private.prevent_delete();


--
-- Name: waiver_templates waiver_templates_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waiver_templates_immutable BEFORE UPDATE ON public.waiver_templates FOR EACH ROW EXECUTE FUNCTION private.waiver_templates_immutable();


--
-- Name: waiver_templates waiver_templates_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waiver_templates_no_delete BEFORE DELETE ON public.waiver_templates FOR EACH ROW EXECUTE FUNCTION private.prevent_delete();


--
-- Name: Locations Locations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Locations"
    ADD CONSTRAINT "Locations_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: agreement_signatures agreement_signatures_crm_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_crm_contact_id_fkey FOREIGN KEY (crm_contact_id) REFERENCES public.crm_contacts(id) ON DELETE SET NULL;


--
-- Name: agreement_signatures agreement_signatures_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: agreement_signatures agreement_signatures_pos_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_pos_item_id_fkey FOREIGN KEY (pos_item_id) REFERENCES public.pos_items(id) ON DELETE SET NULL;


--
-- Name: agreement_signatures agreement_signatures_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.pos_sales(id) ON DELETE SET NULL;


--
-- Name: agreement_signatures agreement_signatures_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: agreement_signatures agreement_signatures_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.agreement_templates(id) ON DELETE SET NULL;


--
-- Name: agreement_templates agreement_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_templates
    ADD CONSTRAINT agreement_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: agreement_templates agreement_templates_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_templates
    ADD CONSTRAINT agreement_templates_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: appointment_occurrences appointment_occurrences_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_occurrences
    ADD CONSTRAINT appointment_occurrences_location_id_fkey FOREIGN KEY (location_id) REFERENCES public."Locations"(id);


--
-- Name: appointment_occurrences appointment_occurrences_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_occurrences
    ADD CONSTRAINT appointment_occurrences_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: appointment_occurrences appointment_occurrences_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_occurrences
    ADD CONSTRAINT appointment_occurrences_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: billing_adjustments billing_adjustments_cancelled_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_adjustments
    ADD CONSTRAINT billing_adjustments_cancelled_by_staff_id_fkey FOREIGN KEY (cancelled_by_staff_id) REFERENCES public.staff(id);


--
-- Name: billing_adjustments billing_adjustments_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_adjustments
    ADD CONSTRAINT billing_adjustments_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: billing_adjustments billing_adjustments_member_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_adjustments
    ADD CONSTRAINT billing_adjustments_member_contract_id_fkey FOREIGN KEY (member_contract_id) REFERENCES public.member_contracts(id) ON DELETE SET NULL;


--
-- Name: billing_adjustments billing_adjustments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_adjustments
    ADD CONSTRAINT billing_adjustments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: billing_cutover_rows billing_cutover_rows_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_cutover_rows
    ADD CONSTRAINT billing_cutover_rows_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: billing_cutover_rows billing_cutover_rows_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_cutover_rows
    ADD CONSTRAINT billing_cutover_rows_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.member_billing_schedules(id) ON DELETE SET NULL;


--
-- Name: billing_cutover_settings billing_cutover_settings_locked_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_cutover_settings
    ADD CONSTRAINT billing_cutover_settings_locked_by_staff_id_fkey FOREIGN KEY (locked_by_staff_id) REFERENCES public.staff(id);


--
-- Name: billing_cutover_settings billing_cutover_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_cutover_settings
    ADD CONSTRAINT billing_cutover_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: billing_cutover_settings billing_cutover_settings_snapshot_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_cutover_settings
    ADD CONSTRAINT billing_cutover_settings_snapshot_by_staff_id_fkey FOREIGN KEY (snapshot_by_staff_id) REFERENCES public.staff(id);


--
-- Name: billing_overage_charges billing_overage_charges_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_overage_charges
    ADD CONSTRAINT billing_overage_charges_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: billing_test_members billing_test_members_added_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_test_members
    ADD CONSTRAINT billing_test_members_added_by_staff_id_fkey FOREIGN KEY (added_by_staff_id) REFERENCES public.staff(id);


--
-- Name: billing_test_members billing_test_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_test_members
    ADD CONSTRAINT billing_test_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: board_members board_members_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_members
    ADD CONSTRAINT board_members_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.message_boards(id);


--
-- Name: board_members board_members_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_members
    ADD CONSTRAINT board_members_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: board_messages board_messages_author_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_messages
    ADD CONSTRAINT board_messages_author_staff_id_fkey FOREIGN KEY (author_staff_id) REFERENCES public.staff(id);


--
-- Name: board_messages board_messages_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_messages
    ADD CONSTRAINT board_messages_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.message_boards(id);


--
-- Name: board_messages board_messages_deleted_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_messages
    ADD CONSTRAINT board_messages_deleted_by_staff_id_fkey FOREIGN KEY (deleted_by_staff_id) REFERENCES public.staff(id);


--
-- Name: card_expiry_notices card_expiry_notices_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_expiry_notices
    ADD CONSTRAINT card_expiry_notices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: card_expiry_notices card_expiry_notices_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_expiry_notices
    ADD CONSTRAINT card_expiry_notices_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.member_billing_schedules(id) ON DELETE CASCADE;


--
-- Name: card_update_links card_update_links_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_update_links
    ADD CONSTRAINT card_update_links_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: card_update_links card_update_links_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_update_links
    ADD CONSTRAINT card_update_links_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: catalog_edits catalog_edits_edited_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_edits
    ADD CONSTRAINT catalog_edits_edited_by_staff_id_fkey FOREIGN KEY (edited_by_staff_id) REFERENCES public.staff(id);


--
-- Name: catalog_edits catalog_edits_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_edits
    ADD CONSTRAINT catalog_edits_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: check_ins check_ins_checked_in_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_checked_in_by_staff_id_fkey FOREIGN KEY (checked_in_by_staff_id) REFERENCES public.staff(id);


--
-- Name: check_ins check_ins_member_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_member_contract_id_fkey FOREIGN KEY (member_contract_id) REFERENCES public.member_contracts(id) ON DELETE SET NULL;


--
-- Name: check_ins check_ins_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: check_ins check_ins_voided_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_voided_by_staff_id_fkey FOREIGN KEY (voided_by_staff_id) REFERENCES public.staff(id);


--
-- Name: class_bookings class_bookings_booked_by_member_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_booked_by_member_account_id_fkey FOREIGN KEY (booked_by_member_account_id) REFERENCES public.member_accounts(id);


--
-- Name: class_bookings class_bookings_booked_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_booked_by_staff_id_fkey FOREIGN KEY (booked_by_staff_id) REFERENCES public.staff(id);


--
-- Name: class_bookings class_bookings_cancelled_by_member_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_cancelled_by_member_account_id_fkey FOREIGN KEY (cancelled_by_member_account_id) REFERENCES public.member_accounts(id);


--
-- Name: class_bookings class_bookings_cancelled_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_cancelled_by_staff_id_fkey FOREIGN KEY (cancelled_by_staff_id) REFERENCES public.staff(id);


--
-- Name: class_bookings class_bookings_checked_in_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_checked_in_by_staff_id_fkey FOREIGN KEY (checked_in_by_staff_id) REFERENCES public.staff(id);


--
-- Name: class_bookings class_bookings_class_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_class_session_id_fkey FOREIGN KEY (class_session_id) REFERENCES public.class_sessions(id) ON DELETE RESTRICT;


--
-- Name: class_bookings class_bookings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_bookings
    ADD CONSTRAINT class_bookings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: class_occurrences class_occurrences_assistant_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_assistant_staff_id_fkey FOREIGN KEY (assistant_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: class_occurrences class_occurrences_class_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_class_session_id_fkey FOREIGN KEY (class_session_id) REFERENCES public.class_sessions(id) ON DELETE CASCADE;


--
-- Name: class_occurrences class_occurrences_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: class_occurrences class_occurrences_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: class_occurrences class_occurrences_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: class_occurrences class_occurrences_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: class_occurrences class_occurrences_substitute_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_occurrences
    ADD CONSTRAINT class_occurrences_substitute_staff_id_fkey FOREIGN KEY (substitute_staff_id) REFERENCES public.staff(id);


--
-- Name: class_ratings class_ratings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_ratings
    ADD CONSTRAINT class_ratings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: class_ratings class_ratings_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_ratings
    ADD CONSTRAINT class_ratings_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.rating_requests(id) ON DELETE CASCADE;


--
-- Name: class_ratings class_ratings_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_ratings
    ADD CONSTRAINT class_ratings_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: class_schedules class_schedules_assistant_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_assistant_staff_id_fkey FOREIGN KEY (assistant_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: class_schedules class_schedules_class_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_class_type_id_fkey FOREIGN KEY (class_type_id) REFERENCES public.class_types(id) ON DELETE SET NULL;


--
-- Name: class_schedules class_schedules_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: class_schedules class_schedules_layout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_layout_id_fkey FOREIGN KEY (layout_id) REFERENCES public.room_layouts(id) ON DELETE SET NULL;


--
-- Name: class_schedules class_schedules_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: class_schedules class_schedules_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;


--
-- Name: class_schedules class_schedules_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_schedules
    ADD CONSTRAINT class_schedules_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: class_sessions class_sessions_assistant_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_assistant_staff_id_fkey FOREIGN KEY (assistant_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: class_sessions class_sessions_class_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_class_schedule_id_fkey FOREIGN KEY (class_schedule_id) REFERENCES public.class_schedules(id) ON DELETE CASCADE;


--
-- Name: class_sessions class_sessions_class_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_class_type_id_fkey FOREIGN KEY (class_type_id) REFERENCES public.class_types(id) ON DELETE SET NULL;


--
-- Name: class_sessions class_sessions_layout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_layout_id_fkey FOREIGN KEY (layout_id) REFERENCES public.room_layouts(id) ON DELETE SET NULL;


--
-- Name: class_sessions class_sessions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: class_sessions class_sessions_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: class_templates class_templates_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_templates
    ADD CONSTRAINT class_templates_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: class_templates class_templates_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_templates
    ADD CONSTRAINT class_templates_location_id_fkey FOREIGN KEY (location_id) REFERENCES public."Locations"(id);


--
-- Name: class_templates class_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_templates
    ADD CONSTRAINT class_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: class_templates class_templates_primary_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_templates
    ADD CONSTRAINT class_templates_primary_staff_id_fkey FOREIGN KEY (primary_staff_id) REFERENCES public.staff(id);


--
-- Name: class_templates class_templates_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_templates
    ADD CONSTRAINT class_templates_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: class_types class_types_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_types
    ADD CONSTRAINT class_types_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: class_types class_types_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_types
    ADD CONSTRAINT class_types_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: class_visits_mindbody class_visits_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_visits_mindbody
    ADD CONSTRAINT class_visits_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES public.class_occurrences(id) ON DELETE CASCADE;


--
-- Name: class_visits_mindbody class_visits_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_visits_mindbody
    ADD CONSTRAINT class_visits_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: clients clients_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: commission_items commission_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_items
    ADD CONSTRAINT commission_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: commission_items commission_items_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_items
    ADD CONSTRAINT commission_items_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: commission_lines commission_lines_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_lines
    ADD CONSTRAINT commission_lines_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: commission_lines commission_lines_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_lines
    ADD CONSTRAINT commission_lines_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.commission_plans(id);


--
-- Name: commission_lines commission_lines_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_lines
    ADD CONSTRAINT commission_lines_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.commission_rules(id) ON DELETE SET NULL;


--
-- Name: commission_lines commission_lines_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_lines
    ADD CONSTRAINT commission_lines_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: commission_plans commission_plans_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_plans
    ADD CONSTRAINT commission_plans_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: commission_rules commission_rules_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules
    ADD CONSTRAINT commission_rules_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: commission_rules commission_rules_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules
    ADD CONSTRAINT commission_rules_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.commission_plans(id) ON DELETE CASCADE;


--
-- Name: commission_sale_credits commission_sale_credits_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_sale_credits
    ADD CONSTRAINT commission_sale_credits_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: commission_sale_credits commission_sale_credits_set_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_sale_credits
    ADD CONSTRAINT commission_sale_credits_set_by_staff_id_fkey FOREIGN KEY (set_by_staff_id) REFERENCES public.staff(id);


--
-- Name: commission_sale_credits commission_sale_credits_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_sale_credits
    ADD CONSTRAINT commission_sale_credits_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: commission_sale_flags commission_sale_flags_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_sale_flags
    ADD CONSTRAINT commission_sale_flags_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: commission_sale_flags commission_sale_flags_set_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_sale_flags
    ADD CONSTRAINT commission_sale_flags_set_by_staff_id_fkey FOREIGN KEY (set_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_appointments crm_appointments_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_appointments crm_appointments_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_appointments crm_appointments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_appointments crm_appointments_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: crm_appointments crm_appointments_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.guest_visits(id);


--
-- Name: crm_contacts crm_contacts_assigned_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_assigned_staff_id_fkey FOREIGN KEY (assigned_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_closed_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_closed_by_staff_id_fkey FOREIGN KEY (closed_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_created_by_kiosk_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_created_by_kiosk_device_id_fkey FOREIGN KEY (created_by_kiosk_device_id) REFERENCES public.kiosk_devices(id);


--
-- Name: crm_contacts crm_contacts_created_by_lead_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_created_by_lead_form_id_fkey FOREIGN KEY (created_by_lead_form_id) REFERENCES public.crm_lead_forms(id);


--
-- Name: crm_contacts crm_contacts_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_deleted_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_deleted_by_staff_id_fkey FOREIGN KEY (deleted_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_follow_up_set_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_follow_up_set_by_staff_id_fkey FOREIGN KEY (follow_up_set_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.crm_import_batches(id) ON DELETE SET NULL;


--
-- Name: crm_contacts crm_contacts_intro_declined_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_intro_declined_by_staff_id_fkey FOREIGN KEY (intro_declined_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_membership_sold_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_membership_sold_by_staff_id_fkey FOREIGN KEY (membership_sold_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_contacts crm_contacts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_contacts crm_contacts_possible_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_possible_duplicate_of_fkey FOREIGN KEY (possible_duplicate_of) REFERENCES public.crm_contacts(id);


--
-- Name: crm_contacts crm_contacts_referrer_set_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_referrer_set_by_staff_id_fkey FOREIGN KEY (referrer_set_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_referring_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_referring_client_id_fkey FOREIGN KEY (referring_client_id) REFERENCES public.clients(id);


--
-- Name: crm_contacts crm_contacts_trainer_assigned_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_trainer_assigned_by_staff_id_fkey FOREIGN KEY (trainer_assigned_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_contacts crm_contacts_trainer_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_trainer_staff_id_fkey FOREIGN KEY (trainer_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_import_batches crm_import_batches_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_import_batches
    ADD CONSTRAINT crm_import_batches_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_import_batches crm_import_batches_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_import_batches
    ADD CONSTRAINT crm_import_batches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_import_batches crm_import_batches_undone_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_import_batches
    ADD CONSTRAINT crm_import_batches_undone_by_staff_id_fkey FOREIGN KEY (undone_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_imported_activity crm_imported_activity_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_imported_activity
    ADD CONSTRAINT crm_imported_activity_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE CASCADE;


--
-- Name: crm_imported_activity crm_imported_activity_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_imported_activity
    ADD CONSTRAINT crm_imported_activity_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.crm_import_batches(id) ON DELETE CASCADE;


--
-- Name: crm_imported_activity crm_imported_activity_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_imported_activity
    ADD CONSTRAINT crm_imported_activity_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_jobs crm_jobs_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_jobs
    ADD CONSTRAINT crm_jobs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_jobs crm_jobs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_jobs
    ADD CONSTRAINT crm_jobs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_kpi_targets crm_kpi_targets_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_kpi_targets
    ADD CONSTRAINT crm_kpi_targets_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_kpi_targets crm_kpi_targets_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_kpi_targets
    ADD CONSTRAINT crm_kpi_targets_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: crm_kpi_targets crm_kpi_targets_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_kpi_targets
    ADD CONSTRAINT crm_kpi_targets_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_lead_forms crm_lead_forms_assigned_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_assigned_staff_id_fkey FOREIGN KEY (assigned_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_lead_forms crm_lead_forms_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_lead_forms crm_lead_forms_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_marketing_sources crm_marketing_sources_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_marketing_sources
    ADD CONSTRAINT crm_marketing_sources_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_messages crm_messages_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_messages crm_messages_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_messages crm_messages_sent_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_sent_by_staff_id_fkey FOREIGN KEY (sent_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_notes crm_notes_author_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_author_staff_id_fkey FOREIGN KEY (author_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_notes crm_notes_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_notes crm_notes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_pending_matches crm_pending_matches_candidate_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pending_matches
    ADD CONSTRAINT crm_pending_matches_candidate_contact_id_fkey FOREIGN KEY (candidate_contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_pending_matches crm_pending_matches_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pending_matches
    ADD CONSTRAINT crm_pending_matches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: crm_pending_matches crm_pending_matches_resolved_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pending_matches
    ADD CONSTRAINT crm_pending_matches_resolved_by_staff_id_fkey FOREIGN KEY (resolved_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_pending_matches crm_pending_matches_submitted_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pending_matches
    ADD CONSTRAINT crm_pending_matches_submitted_contact_id_fkey FOREIGN KEY (submitted_contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_spam_submissions crm_spam_submissions_lead_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_spam_submissions
    ADD CONSTRAINT crm_spam_submissions_lead_form_id_fkey FOREIGN KEY (lead_form_id) REFERENCES public.crm_lead_forms(id) ON DELETE SET NULL;


--
-- Name: crm_spam_submissions crm_spam_submissions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_spam_submissions
    ADD CONSTRAINT crm_spam_submissions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_spam_submissions crm_spam_submissions_released_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_spam_submissions
    ADD CONSTRAINT crm_spam_submissions_released_by_staff_id_fkey FOREIGN KEY (released_by_staff_id) REFERENCES public.staff(id);


--
-- Name: crm_spam_submissions crm_spam_submissions_released_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_spam_submissions
    ADD CONSTRAINT crm_spam_submissions_released_contact_id_fkey FOREIGN KEY (released_contact_id) REFERENCES public.crm_contacts(id) ON DELETE SET NULL;


--
-- Name: department_categories department_categories_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_categories
    ADD CONSTRAINT department_categories_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: department_categories department_categories_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_categories
    ADD CONSTRAINT department_categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: departments departments_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_location_id_fkey FOREIGN KEY (location_id) REFERENCES public."Locations"(id);


--
-- Name: departments departments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: departments departments_required_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_required_item_id_fkey FOREIGN KEY (required_item_id) REFERENCES public.included_items(id) ON DELETE SET NULL;


--
-- Name: email_settings email_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_settings
    ADD CONSTRAINT email_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: email_settings email_settings_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_settings
    ADD CONSTRAINT email_settings_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: email_templates email_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: email_templates email_templates_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: email_unsubscribes email_unsubscribes_newsletter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribes
    ADD CONSTRAINT email_unsubscribes_newsletter_id_fkey FOREIGN KEY (newsletter_id) REFERENCES public.newsletters(id) ON DELETE SET NULL;


--
-- Name: email_unsubscribes email_unsubscribes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribes
    ADD CONSTRAINT email_unsubscribes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: fitness_goals fitness_goals_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_goals
    ADD CONSTRAINT fitness_goals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: fitness_goals fitness_goals_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_goals
    ADD CONSTRAINT fitness_goals_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: followup_conversations followup_conversations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_conversations
    ADD CONSTRAINT followup_conversations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: followup_conversations followup_conversations_instructor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_conversations
    ADD CONSTRAINT followup_conversations_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.staff(id);


--
-- Name: followup_conversations followup_conversations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_conversations
    ADD CONSTRAINT followup_conversations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: followup_messages followup_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_messages
    ADD CONSTRAINT followup_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.followup_conversations(id) ON DELETE CASCADE;


--
-- Name: followup_messages followup_messages_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_messages
    ADD CONSTRAINT followup_messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: guest_visits guest_visits_assigned_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_assigned_staff_id_fkey FOREIGN KEY (assigned_staff_id) REFERENCES public.staff(id);


--
-- Name: guest_visits guest_visits_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: guest_visits guest_visits_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: guest_visits guest_visits_kiosk_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_kiosk_device_id_fkey FOREIGN KEY (kiosk_device_id) REFERENCES public.kiosk_devices(id);


--
-- Name: guest_visits guest_visits_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: included_item_grants included_item_grants_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.included_item_grants
    ADD CONSTRAINT included_item_grants_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.included_items(id) ON DELETE CASCADE;


--
-- Name: included_item_grants included_item_grants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.included_item_grants
    ADD CONSTRAINT included_item_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: included_item_grants included_item_grants_pos_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.included_item_grants
    ADD CONSTRAINT included_item_grants_pos_item_id_fkey FOREIGN KEY (pos_item_id) REFERENCES public.pos_items(id) ON DELETE CASCADE;


--
-- Name: included_items included_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.included_items
    ADD CONSTRAINT included_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: instructor_class_eligibility instructor_class_eligibility_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_class_eligibility
    ADD CONSTRAINT instructor_class_eligibility_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: instructor_class_eligibility instructor_class_eligibility_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_class_eligibility
    ADD CONSTRAINT instructor_class_eligibility_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: instructor_class_eligibility instructor_class_eligibility_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_class_eligibility
    ADD CONSTRAINT instructor_class_eligibility_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.staff(id);


--
-- Name: instructor_reviews instructor_reviews_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_reviews
    ADD CONSTRAINT instructor_reviews_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.report_imports(id);


--
-- Name: instructor_reviews instructor_reviews_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_reviews
    ADD CONSTRAINT instructor_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: instructor_reviews instructor_reviews_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_reviews
    ADD CONSTRAINT instructor_reviews_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: inventory_categories inventory_categories_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_categories
    ADD CONSTRAINT inventory_categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: inventory_categories inventory_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_categories
    ADD CONSTRAINT inventory_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.inventory_categories(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_pos_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pos_item_id_fkey FOREIGN KEY (pos_item_id) REFERENCES public.pos_items(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: kiosk_devices kiosk_devices_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_devices
    ADD CONSTRAINT kiosk_devices_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: kiosk_devices kiosk_devices_on_duty_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_devices
    ADD CONSTRAINT kiosk_devices_on_duty_staff_id_fkey FOREIGN KEY (on_duty_staff_id) REFERENCES public.staff(id);


--
-- Name: kiosk_devices kiosk_devices_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_devices
    ADD CONSTRAINT kiosk_devices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: kiosk_match_tokens kiosk_match_tokens_kiosk_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_match_tokens
    ADD CONSTRAINT kiosk_match_tokens_kiosk_device_id_fkey FOREIGN KEY (kiosk_device_id) REFERENCES public.kiosk_devices(id);


--
-- Name: kiosk_match_tokens kiosk_match_tokens_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_match_tokens
    ADD CONSTRAINT kiosk_match_tokens_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: maintenance_equipment maintenance_equipment_default_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_equipment
    ADD CONSTRAINT maintenance_equipment_default_vendor_id_fkey FOREIGN KEY (default_vendor_id) REFERENCES public.maintenance_vendors(id) ON DELETE SET NULL;


--
-- Name: maintenance_equipment maintenance_equipment_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_equipment
    ADD CONSTRAINT maintenance_equipment_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: maintenance_equipment maintenance_equipment_owner_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_equipment
    ADD CONSTRAINT maintenance_equipment_owner_staff_id_fkey FOREIGN KEY (owner_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: maintenance_events maintenance_events_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_events
    ADD CONSTRAINT maintenance_events_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.maintenance_issues(id) ON DELETE CASCADE;


--
-- Name: maintenance_events maintenance_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_events
    ADD CONSTRAINT maintenance_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: maintenance_events maintenance_events_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_events
    ADD CONSTRAINT maintenance_events_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: maintenance_events maintenance_events_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_events
    ADD CONSTRAINT maintenance_events_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.maintenance_vendors(id) ON DELETE SET NULL;


--
-- Name: maintenance_issues maintenance_issues_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_issues
    ADD CONSTRAINT maintenance_issues_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.maintenance_equipment(id) ON DELETE SET NULL;


--
-- Name: maintenance_issues maintenance_issues_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_issues
    ADD CONSTRAINT maintenance_issues_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: maintenance_issues maintenance_issues_reported_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_issues
    ADD CONSTRAINT maintenance_issues_reported_by_staff_id_fkey FOREIGN KEY (reported_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: maintenance_issues maintenance_issues_resolved_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_issues
    ADD CONSTRAINT maintenance_issues_resolved_by_staff_id_fkey FOREIGN KEY (resolved_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: maintenance_issues maintenance_issues_vendor_approved_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_issues
    ADD CONSTRAINT maintenance_issues_vendor_approved_by_staff_id_fkey FOREIGN KEY (vendor_approved_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: maintenance_issues maintenance_issues_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_issues
    ADD CONSTRAINT maintenance_issues_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.maintenance_vendors(id) ON DELETE SET NULL;


--
-- Name: maintenance_media maintenance_media_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_media
    ADD CONSTRAINT maintenance_media_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.maintenance_issues(id) ON DELETE CASCADE;


--
-- Name: maintenance_media maintenance_media_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_media
    ADD CONSTRAINT maintenance_media_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: maintenance_media maintenance_media_uploaded_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_media
    ADD CONSTRAINT maintenance_media_uploaded_by_staff_id_fkey FOREIGN KEY (uploaded_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: maintenance_vendors maintenance_vendors_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_vendors
    ADD CONSTRAINT maintenance_vendors_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mbo_autopay_rows mbo_autopay_rows_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mbo_autopay_rows
    ADD CONSTRAINT mbo_autopay_rows_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.report_imports(id) ON DELETE SET NULL;


--
-- Name: mbo_autopay_rows mbo_autopay_rows_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mbo_autopay_rows
    ADD CONSTRAINT mbo_autopay_rows_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_accounts member_accounts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_accounts
    ADD CONSTRAINT member_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_billing_schedules member_billing_schedules_crm_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_billing_schedules
    ADD CONSTRAINT member_billing_schedules_crm_contact_id_fkey FOREIGN KEY (crm_contact_id) REFERENCES public.crm_contacts(id) ON DELETE SET NULL;


--
-- Name: member_billing_schedules member_billing_schedules_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_billing_schedules
    ADD CONSTRAINT member_billing_schedules_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_billing_schedules member_billing_schedules_pos_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_billing_schedules
    ADD CONSTRAINT member_billing_schedules_pos_item_id_fkey FOREIGN KEY (pos_item_id) REFERENCES public.pos_items(id);


--
-- Name: member_billing_schedules member_billing_schedules_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_billing_schedules
    ADD CONSTRAINT member_billing_schedules_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.pos_sales(id) ON DELETE CASCADE;


--
-- Name: member_cards member_cards_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_cards
    ADD CONSTRAINT member_cards_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_cards member_cards_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_cards
    ADD CONSTRAINT member_cards_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: member_contract_sync member_contract_sync_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_contract_sync
    ADD CONSTRAINT member_contract_sync_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_contracts member_contracts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_contracts
    ADD CONSTRAINT member_contracts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_contracts member_contracts_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_contracts
    ADD CONSTRAINT member_contracts_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id) ON DELETE SET NULL;


--
-- Name: member_id_counters member_id_counters_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_id_counters
    ADD CONSTRAINT member_id_counters_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_personal member_personal_edited_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal
    ADD CONSTRAINT member_personal_edited_by_staff_id_fkey FOREIGN KEY (edited_by_staff_id) REFERENCES public.staff(id);


--
-- Name: member_personal_edits member_personal_edits_edited_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal_edits
    ADD CONSTRAINT member_personal_edits_edited_by_staff_id_fkey FOREIGN KEY (edited_by_staff_id) REFERENCES public.staff(id);


--
-- Name: member_personal_edits member_personal_edits_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal_edits
    ADD CONSTRAINT member_personal_edits_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_personal member_personal_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal
    ADD CONSTRAINT member_personal_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_profile_sync member_profile_sync_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile_sync
    ADD CONSTRAINT member_profile_sync_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_sale_items member_sale_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sale_items
    ADD CONSTRAINT member_sale_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_sales member_sales_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sales
    ADD CONSTRAINT member_sales_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_services member_services_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_services
    ADD CONSTRAINT member_services_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: member_sessions member_sessions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sessions
    ADD CONSTRAINT member_sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.member_accounts(id) ON DELETE CASCADE;


--
-- Name: member_tokens member_tokens_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_tokens
    ADD CONSTRAINT member_tokens_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.member_accounts(id) ON DELETE CASCADE;


--
-- Name: member_visits member_visits_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_visits
    ADD CONSTRAINT member_visits_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: membership_charges membership_charges_moved_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_charges
    ADD CONSTRAINT membership_charges_moved_by_staff_id_fkey FOREIGN KEY (moved_by_staff_id) REFERENCES public.staff(id);


--
-- Name: membership_charges membership_charges_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_charges
    ADD CONSTRAINT membership_charges_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: membership_charges membership_charges_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_charges
    ADD CONSTRAINT membership_charges_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.pos_sales(id) ON DELETE SET NULL;


--
-- Name: membership_charges membership_charges_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_charges
    ADD CONSTRAINT membership_charges_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.member_billing_schedules(id) ON DELETE CASCADE;


--
-- Name: membership_plans membership_plans_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: message_boards message_boards_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_boards
    ADD CONSTRAINT message_boards_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: message_boards message_boards_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_boards
    ADD CONSTRAINT message_boards_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: message_boards message_boards_substitution_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_boards
    ADD CONSTRAINT message_boards_substitution_request_id_fkey FOREIGN KEY (substitution_request_id) REFERENCES public.substitution_requests(id);


--
-- Name: milestone_emails milestone_emails_decided_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_emails
    ADD CONSTRAINT milestone_emails_decided_by_staff_id_fkey FOREIGN KEY (decided_by_staff_id) REFERENCES public.staff(id);


--
-- Name: milestone_emails milestone_emails_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_emails
    ADD CONSTRAINT milestone_emails_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: milestone_emails milestone_emails_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_emails
    ADD CONSTRAINT milestone_emails_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: milestone_templates milestone_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_templates
    ADD CONSTRAINT milestone_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: milestone_templates milestone_templates_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_templates
    ADD CONSTRAINT milestone_templates_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: milestone_templates milestone_templates_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestone_templates
    ADD CONSTRAINT milestone_templates_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: mindbody_item_types mindbody_item_types_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mindbody_item_types
    ADD CONSTRAINT mindbody_item_types_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: mindbody_item_types mindbody_item_types_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mindbody_item_types
    ADD CONSTRAINT mindbody_item_types_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: newsletter_recipients newsletter_recipients_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_recipients
    ADD CONSTRAINT newsletter_recipients_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: newsletter_recipients newsletter_recipients_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_recipients
    ADD CONSTRAINT newsletter_recipients_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE CASCADE;


--
-- Name: newsletter_recipients newsletter_recipients_newsletter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_recipients
    ADD CONSTRAINT newsletter_recipients_newsletter_id_fkey FOREIGN KEY (newsletter_id) REFERENCES public.newsletters(id) ON DELETE CASCADE;


--
-- Name: newsletter_recipients newsletter_recipients_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_recipients
    ADD CONSTRAINT newsletter_recipients_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: newsletters newsletters_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT newsletters_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: newsletters newsletters_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT newsletters_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: newsletters newsletters_scheduled_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT newsletters_scheduled_by_staff_id_fkey FOREIGN KEY (scheduled_by_staff_id) REFERENCES public.staff(id);


--
-- Name: org_modules org_modules_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_modules
    ADD CONSTRAINT org_modules_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: organizations organizations_mindbody_disconnected_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_mindbody_disconnected_by_staff_id_fkey FOREIGN KEY (mindbody_disconnected_by_staff_id) REFERENCES public.staff(id);


--
-- Name: pay_rates pay_rates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rates
    ADD CONSTRAINT pay_rates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pay_rates pay_rates_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rates
    ADD CONSTRAINT pay_rates_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: payment_disputes payment_disputes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_disputes
    ADD CONSTRAINT payment_disputes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: payment_disputes payment_disputes_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_disputes
    ADD CONSTRAINT payment_disputes_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.pos_sales(id) ON DELETE SET NULL;


--
-- Name: payroll_events payroll_events_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_events
    ADD CONSTRAINT payroll_events_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: payroll_events payroll_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_events
    ADD CONSTRAINT payroll_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: payroll_events payroll_events_pay_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_events
    ADD CONSTRAINT payroll_events_pay_rate_id_fkey FOREIGN KEY (pay_rate_id) REFERENCES public.pay_rates(id) ON DELETE SET NULL;


--
-- Name: payroll_events payroll_events_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_events
    ADD CONSTRAINT payroll_events_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: payroll_events payroll_events_trainer_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_events
    ADD CONSTRAINT payroll_events_trainer_session_id_fkey FOREIGN KEY (trainer_session_id) REFERENCES public.trainer_sessions(id) ON DELETE CASCADE;


--
-- Name: payroll_events payroll_events_voided_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_events
    ADD CONSTRAINT payroll_events_voided_by_staff_id_fkey FOREIGN KEY (voided_by_staff_id) REFERENCES public.staff(id);


--
-- Name: payroll_line_items payroll_line_items_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_line_items
    ADD CONSTRAINT payroll_line_items_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.report_imports(id);


--
-- Name: payroll_line_items payroll_line_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_line_items
    ADD CONSTRAINT payroll_line_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: payroll_line_items payroll_line_items_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_line_items
    ADD CONSTRAINT payroll_line_items_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: platform_admins platform_admins_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pos_card_payments pos_card_payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_card_payments
    ADD CONSTRAINT pos_card_payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pos_card_payments pos_card_payments_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_card_payments
    ADD CONSTRAINT pos_card_payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.pos_sales(id) ON DELETE SET NULL;


--
-- Name: pos_card_payments pos_card_payments_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_card_payments
    ADD CONSTRAINT pos_card_payments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: pos_items pos_items_agreement_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_items
    ADD CONSTRAINT pos_items_agreement_template_id_fkey FOREIGN KEY (agreement_template_id) REFERENCES public.agreement_templates(id) ON DELETE SET NULL;


--
-- Name: pos_items pos_items_inventory_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_items
    ADD CONSTRAINT pos_items_inventory_category_id_fkey FOREIGN KEY (inventory_category_id) REFERENCES public.inventory_categories(id) ON DELETE SET NULL;


--
-- Name: pos_items pos_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_items
    ADD CONSTRAINT pos_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pos_items pos_items_revenue_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_items
    ADD CONSTRAINT pos_items_revenue_category_id_fkey FOREIGN KEY (revenue_category_id) REFERENCES public.revenue_categories(id);


--
-- Name: pos_items pos_items_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_items
    ADD CONSTRAINT pos_items_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: pos_sale_lines pos_sale_lines_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sale_lines
    ADD CONSTRAINT pos_sale_lines_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pos_sale_lines pos_sale_lines_package_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sale_lines
    ADD CONSTRAINT pos_sale_lines_package_item_id_fkey FOREIGN KEY (package_item_id) REFERENCES public.pos_items(id);


--
-- Name: pos_sale_lines pos_sale_lines_pos_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sale_lines
    ADD CONSTRAINT pos_sale_lines_pos_item_id_fkey FOREIGN KEY (pos_item_id) REFERENCES public.pos_items(id);


--
-- Name: pos_sale_lines pos_sale_lines_revenue_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sale_lines
    ADD CONSTRAINT pos_sale_lines_revenue_category_id_fkey FOREIGN KEY (revenue_category_id) REFERENCES public.revenue_categories(id);


--
-- Name: pos_sale_lines pos_sale_lines_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sale_lines
    ADD CONSTRAINT pos_sale_lines_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.pos_sales(id) ON DELETE CASCADE;


--
-- Name: pos_sales pos_sales_crm_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT pos_sales_crm_contact_id_fkey FOREIGN KEY (crm_contact_id) REFERENCES public.crm_contacts(id) ON DELETE SET NULL;


--
-- Name: pos_sales pos_sales_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT pos_sales_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pos_sales pos_sales_promo_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT pos_sales_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES public.promo_codes(id);


--
-- Name: pos_sales pos_sales_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT pos_sales_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: pos_sales pos_sales_voided_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT pos_sales_voided_by_staff_id_fkey FOREIGN KEY (voided_by_staff_id) REFERENCES public.staff(id);


--
-- Name: practice_charges practice_charges_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_charges
    ADD CONSTRAINT practice_charges_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: practice_charges practice_charges_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_charges
    ADD CONSTRAINT practice_charges_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.member_billing_schedules(id) ON DELETE CASCADE;


--
-- Name: price_increase_items price_increase_items_member_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increase_items
    ADD CONSTRAINT price_increase_items_member_contract_id_fkey FOREIGN KEY (member_contract_id) REFERENCES public.member_contracts(id) ON DELETE SET NULL;


--
-- Name: price_increase_items price_increase_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increase_items
    ADD CONSTRAINT price_increase_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: price_increase_items price_increase_items_price_increase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increase_items
    ADD CONSTRAINT price_increase_items_price_increase_id_fkey FOREIGN KEY (price_increase_id) REFERENCES public.price_increases(id) ON DELETE CASCADE;


--
-- Name: price_increases price_increases_cancelled_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increases
    ADD CONSTRAINT price_increases_cancelled_by_staff_id_fkey FOREIGN KEY (cancelled_by_staff_id) REFERENCES public.staff(id);


--
-- Name: price_increases price_increases_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increases
    ADD CONSTRAINT price_increases_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: price_increases price_increases_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_increases
    ADD CONSTRAINT price_increases_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: promo_codes promo_codes_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_codes
    ADD CONSTRAINT promo_codes_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: promo_codes promo_codes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_codes
    ADD CONSTRAINT promo_codes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: push_subscriptions push_subscriptions_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: rating_opt_outs rating_opt_outs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_opt_outs
    ADD CONSTRAINT rating_opt_outs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: rating_requests rating_requests_class_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_requests
    ADD CONSTRAINT rating_requests_class_occurrence_id_fkey FOREIGN KEY (class_occurrence_id) REFERENCES public.class_occurrences(id) ON DELETE SET NULL;


--
-- Name: rating_requests rating_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_requests
    ADD CONSTRAINT rating_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: rating_requests rating_requests_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_requests
    ADD CONSTRAINT rating_requests_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: report_imports report_imports_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_imports
    ADD CONSTRAINT report_imports_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: report_imports report_imports_uploaded_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_imports
    ADD CONSTRAINT report_imports_uploaded_by_staff_id_fkey FOREIGN KEY (uploaded_by_staff_id) REFERENCES public.staff(id);


--
-- Name: revenue_categories revenue_categories_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_categories
    ADD CONSTRAINT revenue_categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: revenue_line_items revenue_line_items_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_line_items
    ADD CONSTRAINT revenue_line_items_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: revenue_line_items revenue_line_items_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_line_items
    ADD CONSTRAINT revenue_line_items_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.report_imports(id);


--
-- Name: revenue_line_items revenue_line_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_line_items
    ADD CONSTRAINT revenue_line_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: revenue_line_items revenue_line_items_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_line_items
    ADD CONSTRAINT revenue_line_items_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: room_layouts room_layouts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_layouts
    ADD CONSTRAINT room_layouts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: room_layouts room_layouts_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_layouts
    ADD CONSTRAINT room_layouts_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_layouts room_layouts_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_layouts
    ADD CONSTRAINT room_layouts_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: rooms rooms_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_location_id_fkey FOREIGN KEY (location_id) REFERENCES public."Locations"(id);


--
-- Name: rooms rooms_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: sale_items sale_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: sales sales_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: sales sales_sales_rep_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_sales_rep_staff_id_fkey FOREIGN KEY (sales_rep_staff_id) REFERENCES public.staff(id);


--
-- Name: session_pack_uses session_pack_uses_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_pack_uses
    ADD CONSTRAINT session_pack_uses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: session_pack_uses session_pack_uses_session_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_pack_uses
    ADD CONSTRAINT session_pack_uses_session_pack_id_fkey FOREIGN KEY (session_pack_id) REFERENCES public.session_packs(id) ON DELETE CASCADE;


--
-- Name: session_pack_uses session_pack_uses_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_pack_uses
    ADD CONSTRAINT session_pack_uses_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: session_pack_uses session_pack_uses_trainer_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_pack_uses
    ADD CONSTRAINT session_pack_uses_trainer_session_id_fkey FOREIGN KEY (trainer_session_id) REFERENCES public.trainer_sessions(id) ON DELETE SET NULL;


--
-- Name: session_pack_uses session_pack_uses_voided_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_pack_uses
    ADD CONSTRAINT session_pack_uses_voided_by_staff_id_fkey FOREIGN KEY (voided_by_staff_id) REFERENCES public.staff(id);


--
-- Name: session_packs session_packs_crm_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_packs
    ADD CONSTRAINT session_packs_crm_contact_id_fkey FOREIGN KEY (crm_contact_id) REFERENCES public.crm_contacts(id) ON DELETE SET NULL;


--
-- Name: session_packs session_packs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_packs
    ADD CONSTRAINT session_packs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: session_packs session_packs_pos_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_packs
    ADD CONSTRAINT session_packs_pos_item_id_fkey FOREIGN KEY (pos_item_id) REFERENCES public.pos_items(id) ON DELETE SET NULL;


--
-- Name: session_packs session_packs_pos_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_packs
    ADD CONSTRAINT session_packs_pos_sale_id_fkey FOREIGN KEY (pos_sale_id) REFERENCES public.pos_sales(id) ON DELETE SET NULL;


--
-- Name: session_types session_types_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_types
    ADD CONSTRAINT session_types_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: staff staff_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: staff staff_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_location_id_fkey FOREIGN KEY (location_id) REFERENCES public."Locations"(id);


--
-- Name: staff staff_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: staff_pay_assignments staff_pay_assignments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_assignments
    ADD CONSTRAINT staff_pay_assignments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: staff_pay_assignments staff_pay_assignments_pay_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_assignments
    ADD CONSTRAINT staff_pay_assignments_pay_rate_id_fkey FOREIGN KEY (pay_rate_id) REFERENCES public.pay_rates(id);


--
-- Name: staff_pay_assignments staff_pay_assignments_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_assignments
    ADD CONSTRAINT staff_pay_assignments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: staff_pay_assignments staff_pay_assignments_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_assignments
    ADD CONSTRAINT staff_pay_assignments_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: staff_pay_settings staff_pay_settings_appointment_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_settings
    ADD CONSTRAINT staff_pay_settings_appointment_rate_id_fkey FOREIGN KEY (appointment_rate_id) REFERENCES public.pay_rates(id);


--
-- Name: staff_pay_settings staff_pay_settings_class_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_settings
    ADD CONSTRAINT staff_pay_settings_class_rate_id_fkey FOREIGN KEY (class_rate_id) REFERENCES public.pay_rates(id);


--
-- Name: staff_pay_settings staff_pay_settings_commission_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_settings
    ADD CONSTRAINT staff_pay_settings_commission_plan_id_fkey FOREIGN KEY (commission_plan_id) REFERENCES public.commission_plans(id);


--
-- Name: staff_pay_settings staff_pay_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_settings
    ADD CONSTRAINT staff_pay_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: staff_pay_settings staff_pay_settings_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_settings
    ADD CONSTRAINT staff_pay_settings_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: staff_pay_settings staff_pay_settings_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_pay_settings
    ADD CONSTRAINT staff_pay_settings_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.staff(id);


--
-- Name: staff_sync_exclusions staff_sync_exclusions_excluded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_sync_exclusions
    ADD CONSTRAINT staff_sync_exclusions_excluded_by_fkey FOREIGN KEY (excluded_by) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: staff_sync_exclusions staff_sync_exclusions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_sync_exclusions
    ADD CONSTRAINT staff_sync_exclusions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: stripe_connected_accounts stripe_connected_accounts_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_connected_accounts
    ADD CONSTRAINT stripe_connected_accounts_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: stripe_connected_accounts stripe_connected_accounts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_connected_accounts
    ADD CONSTRAINT stripe_connected_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: studio_signups studio_signups_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_signups
    ADD CONSTRAINT studio_signups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: substitution_interests substitution_interests_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_interests
    ADD CONSTRAINT substitution_interests_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.substitution_requests(id);


--
-- Name: substitution_interests substitution_interests_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_interests
    ADD CONSTRAINT substitution_interests_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);


--
-- Name: substitution_requests substitution_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.staff(id);


--
-- Name: substitution_requests substitution_requests_approved_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_approved_staff_id_fkey FOREIGN KEY (approved_staff_id) REFERENCES public.staff(id);


--
-- Name: substitution_requests substitution_requests_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES public.class_occurrences(id);


--
-- Name: substitution_requests substitution_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: substitution_requests substitution_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.staff(id);


--
-- Name: sync_state sync_state_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_state
    ADD CONSTRAINT sync_state_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: terminal_readers terminal_readers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_readers
    ADD CONSTRAINT terminal_readers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: terminal_readers terminal_readers_registered_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_readers
    ADD CONSTRAINT terminal_readers_registered_by_staff_id_fkey FOREIGN KEY (registered_by_staff_id) REFERENCES public.staff(id);


--
-- Name: time_punch_edits time_punch_edits_edited_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_punch_edits
    ADD CONSTRAINT time_punch_edits_edited_by_staff_id_fkey FOREIGN KEY (edited_by_staff_id) REFERENCES public.staff(id);


--
-- Name: time_punch_edits time_punch_edits_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_punch_edits
    ADD CONSTRAINT time_punch_edits_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: time_punch_edits time_punch_edits_punch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_punch_edits
    ADD CONSTRAINT time_punch_edits_punch_id_fkey FOREIGN KEY (punch_id) REFERENCES public.time_punches(id) ON DELETE CASCADE;


--
-- Name: time_punches time_punches_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_punches
    ADD CONSTRAINT time_punches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: time_punches time_punches_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_punches
    ADD CONSTRAINT time_punches_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: trainer_availability trainer_availability_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability
    ADD CONSTRAINT trainer_availability_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: trainer_availability trainer_availability_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability
    ADD CONSTRAINT trainer_availability_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: trainer_availability trainer_availability_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability
    ADD CONSTRAINT trainer_availability_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: trainer_sessions trainer_sessions_booked_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_sessions
    ADD CONSTRAINT trainer_sessions_booked_by_staff_id_fkey FOREIGN KEY (booked_by_staff_id) REFERENCES public.staff(id);


--
-- Name: trainer_sessions trainer_sessions_closed_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_sessions
    ADD CONSTRAINT trainer_sessions_closed_by_staff_id_fkey FOREIGN KEY (closed_by_staff_id) REFERENCES public.staff(id);


--
-- Name: trainer_sessions trainer_sessions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_sessions
    ADD CONSTRAINT trainer_sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: trainer_sessions trainer_sessions_session_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_sessions
    ADD CONSTRAINT trainer_sessions_session_pack_id_fkey FOREIGN KEY (session_pack_id) REFERENCES public.session_packs(id) ON DELETE SET NULL;


--
-- Name: trainer_sessions trainer_sessions_trainer_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_sessions
    ADD CONSTRAINT trainer_sessions_trainer_staff_id_fkey FOREIGN KEY (trainer_staff_id) REFERENCES public.staff(id);


--
-- Name: waiver_signatures waiver_signatures_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_signatures
    ADD CONSTRAINT waiver_signatures_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: waiver_signatures waiver_signatures_kiosk_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_signatures
    ADD CONSTRAINT waiver_signatures_kiosk_device_id_fkey FOREIGN KEY (kiosk_device_id) REFERENCES public.kiosk_devices(id);


--
-- Name: waiver_signatures waiver_signatures_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_signatures
    ADD CONSTRAINT waiver_signatures_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: waiver_signatures waiver_signatures_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_signatures
    ADD CONSTRAINT waiver_signatures_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.waiver_templates(id);


--
-- Name: waiver_signatures waiver_signatures_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_signatures
    ADD CONSTRAINT waiver_signatures_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.guest_visits(id);


--
-- Name: waiver_templates waiver_templates_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_templates
    ADD CONSTRAINT waiver_templates_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id);


--
-- Name: waiver_templates waiver_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiver_templates
    ADD CONSTRAINT waiver_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: Locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Locations" ENABLE ROW LEVEL SECURITY;

--
-- Name: agreement_signatures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agreement_signatures ENABLE ROW LEVEL SECURITY;

--
-- Name: agreement_signatures agreement_signatures_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agreement_signatures_select_admin ON public.agreement_signatures FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: agreement_signatures agreement_signatures_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agreement_signatures_select_sales_team ON public.agreement_signatures FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: agreement_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agreement_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: agreement_templates agreement_templates_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agreement_templates_select_admin ON public.agreement_templates FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: appointment_occurrences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_occurrences ENABLE ROW LEVEL SECURITY;

--
-- Name: appointment_occurrences appointment_occurrences_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointment_occurrences_select_same_org ON public.appointment_occurrences FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: billing_adjustments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_adjustments billing_adjustments_insert_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_adjustments_insert_club_admin ON public.billing_adjustments FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: billing_adjustments billing_adjustments_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_adjustments_select_club_admin ON public.billing_adjustments FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: billing_adjustments billing_adjustments_update_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_adjustments_update_club_admin ON public.billing_adjustments FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: billing_cutover_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_cutover_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_cutover_rows billing_cutover_rows_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_cutover_rows_select_admin ON public.billing_cutover_rows FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: billing_cutover_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_cutover_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_cutover_settings billing_cutover_settings_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_cutover_settings_select_admin ON public.billing_cutover_settings FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: billing_overage_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_overage_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_test_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_test_members ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_test_members billing_test_members_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_test_members_select_admin ON public.billing_test_members FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: board_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

--
-- Name: board_members board_members_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_members_insert_admin ON public.board_members FOR INSERT TO authenticated WITH CHECK (((private.current_staff_role() = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.message_boards mb
  WHERE ((mb.id = board_members.board_id) AND (mb.organization_id = private.current_staff_org_id()))))));


--
-- Name: board_members board_members_select_can_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_members_select_can_access ON public.board_members FOR SELECT TO authenticated USING ((private.can_access_board(board_id) OR (staff_id = private.current_staff_id())));


--
-- Name: board_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: board_messages board_messages_insert_can_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_messages_insert_can_access ON public.board_messages FOR INSERT TO authenticated WITH CHECK (((author_staff_id = private.current_staff_id()) AND private.can_access_board(board_id) AND ((private.current_staff_role() = 'admin'::text) OR (NOT (EXISTS ( SELECT 1
   FROM public.message_boards mb
  WHERE ((mb.id = board_messages.board_id) AND (mb.board_type = 'announcements'::text))))))));


--
-- Name: board_messages board_messages_select_can_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_messages_select_can_access ON public.board_messages FOR SELECT TO authenticated USING (private.can_access_board(board_id));


--
-- Name: card_expiry_notices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_expiry_notices ENABLE ROW LEVEL SECURITY;

--
-- Name: card_expiry_notices card_expiry_notices_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY card_expiry_notices_select_admin ON public.card_expiry_notices FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: card_update_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_update_links ENABLE ROW LEVEL SECURITY;

--
-- Name: card_update_links card_update_links_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY card_update_links_select_admin ON public.card_update_links FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: catalog_edits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.catalog_edits ENABLE ROW LEVEL SECURITY;

--
-- Name: catalog_edits catalog_edits_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY catalog_edits_select_club_admin ON public.catalog_edits FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: check_ins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;

--
-- Name: check_ins check_ins_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY check_ins_select_same_org ON public.check_ins FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: class_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: class_bookings class_bookings_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_bookings_select_same_org ON public.class_bookings FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: class_occurrences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_occurrences ENABLE ROW LEVEL SECURITY;

--
-- Name: class_occurrences class_occurrences_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_occurrences_select_same_org ON public.class_occurrences FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: class_occurrences class_occurrences_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_occurrences_update_admin ON public.class_occurrences FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: class_occurrences class_occurrences_update_clear_own_substitute; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_occurrences_update_clear_own_substitute ON public.class_occurrences FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((staff_id = private.current_staff_id()) OR (substitute_staff_id = private.current_staff_id())))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (substitute_staff_id IS NULL)));


--
-- Name: class_ratings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_ratings ENABLE ROW LEVEL SECURITY;

--
-- Name: class_ratings class_ratings_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_ratings_select_admin ON public.class_ratings FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: class_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: class_schedules class_schedules_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_schedules_select_same_org ON public.class_schedules FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: class_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: class_sessions class_sessions_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_sessions_select_same_org ON public.class_sessions FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: class_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: class_templates class_templates_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_templates_select_same_org ON public.class_templates FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: class_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_types ENABLE ROW LEVEL SECURITY;

--
-- Name: class_types class_types_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_types_select_same_org ON public.class_types FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: class_visits_mindbody; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_visits_mindbody ENABLE ROW LEVEL SECURITY;

--
-- Name: class_visits_mindbody class_visits_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_visits_select_same_org ON public.class_visits_mindbody FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: clients clients_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_select_same_org ON public.clients FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: commission_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_items ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_items commission_items_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_items_select_admin ON public.commission_items FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: commission_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_lines commission_lines_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_lines_select ON public.commission_lines FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (staff_id = private.current_staff_id()))));


--
-- Name: commission_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_plans commission_plans_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_plans_select_admin ON public.commission_plans FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: commission_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_rules commission_rules_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_rules_select_admin ON public.commission_rules FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: commission_sale_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_sale_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_sale_credits commission_sale_credits_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_sale_credits_select ON public.commission_sale_credits FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (staff_id = private.current_staff_id()))));


--
-- Name: commission_sale_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_sale_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_sale_flags commission_sale_flags_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_sale_flags_select_admin ON public.commission_sale_flags FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: crm_appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_appointments crm_appointments_select_assigned_trainer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_appointments_select_assigned_trainer ON public.crm_appointments FOR SELECT TO authenticated USING (private.is_assigned_trainer(contact_id));


--
-- Name: crm_appointments crm_appointments_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_appointments_select_crm ON public.crm_appointments FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: crm_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_contacts crm_contacts_select_assigned_trainer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_contacts_select_assigned_trainer ON public.crm_contacts FOR SELECT TO authenticated USING (private.is_assigned_trainer(id));


--
-- Name: crm_contacts crm_contacts_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_contacts_select_crm ON public.crm_contacts FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: crm_import_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_import_batches crm_import_batches_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_import_batches_select_admin ON public.crm_import_batches FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: crm_imported_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_imported_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_imported_activity crm_imported_activity_select_assigned_trainer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_imported_activity_select_assigned_trainer ON public.crm_imported_activity FOR SELECT TO authenticated USING (private.is_assigned_trainer(contact_id));


--
-- Name: crm_imported_activity crm_imported_activity_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_imported_activity_select_crm ON public.crm_imported_activity FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: crm_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_kpi_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_kpi_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_kpi_targets crm_kpi_targets_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_kpi_targets_select_crm ON public.crm_kpi_targets FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: crm_lead_forms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_lead_forms ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_lead_forms crm_lead_forms_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_lead_forms_select_admin ON public.crm_lead_forms FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: crm_marketing_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_marketing_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_marketing_sources crm_marketing_sources_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_marketing_sources_select_same_org ON public.crm_marketing_sources FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: crm_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_messages crm_messages_select_assigned_trainer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_messages_select_assigned_trainer ON public.crm_messages FOR SELECT TO authenticated USING (private.is_assigned_trainer(contact_id));


--
-- Name: crm_messages crm_messages_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_messages_select_crm ON public.crm_messages FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: crm_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_notes crm_notes_select_assigned_trainer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_notes_select_assigned_trainer ON public.crm_notes FOR SELECT TO authenticated USING (private.is_assigned_trainer(contact_id));


--
-- Name: crm_notes crm_notes_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_notes_select_crm ON public.crm_notes FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: crm_pending_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_pending_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_pending_matches crm_pending_matches_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_pending_matches_select_crm ON public.crm_pending_matches FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: crm_spam_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_spam_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_spam_submissions crm_spam_submissions_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_spam_submissions_select_admin ON public.crm_spam_submissions FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: department_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.department_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: department_categories department_categories_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY department_categories_select_same_org ON public.department_categories FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: departments departments_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_select_same_org ON public.departments FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: email_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: email_settings email_settings_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_settings_select_admin ON public.email_settings FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: email_templates email_templates_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_templates_select_admin ON public.email_templates FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: email_unsubscribes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

--
-- Name: email_unsubscribes email_unsubscribes_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_unsubscribes_select_admin ON public.email_unsubscribes FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: fitness_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fitness_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: fitness_goals fitness_goals_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fitness_goals_select_admin ON public.fitness_goals FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: followup_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.followup_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: followup_conversations followup_conversations_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY followup_conversations_select_own_or_admin ON public.followup_conversations FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((instructor_id = private.current_staff_id()) OR (private.current_staff_role() = 'admin'::text))));


--
-- Name: followup_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.followup_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: followup_messages followup_messages_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY followup_messages_select_own_or_admin ON public.followup_messages FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (EXISTS ( SELECT 1
   FROM public.followup_conversations fc
  WHERE (fc.id = followup_messages.conversation_id)))));


--
-- Name: guest_visits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guest_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: guest_visits guest_visits_select_assigned_trainer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guest_visits_select_assigned_trainer ON public.guest_visits FOR SELECT TO authenticated USING (private.is_assigned_trainer(contact_id));


--
-- Name: guest_visits guest_visits_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guest_visits_select_crm ON public.guest_visits FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: included_item_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.included_item_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: included_item_grants included_item_grants_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY included_item_grants_select_same_org ON public.included_item_grants FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: included_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.included_items ENABLE ROW LEVEL SECURITY;

--
-- Name: included_items included_items_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY included_items_select_same_org ON public.included_items FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: instructor_class_eligibility; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instructor_class_eligibility ENABLE ROW LEVEL SECURITY;

--
-- Name: instructor_class_eligibility instructor_class_eligibility_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instructor_class_eligibility_insert_admin ON public.instructor_class_eligibility FOR INSERT TO authenticated WITH CHECK (((private.current_staff_role() = 'admin'::text) AND (private.staff_org_id(staff_id) = private.current_staff_org_id())));


--
-- Name: instructor_class_eligibility instructor_class_eligibility_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instructor_class_eligibility_select_same_org ON public.instructor_class_eligibility FOR SELECT TO authenticated USING ((private.staff_org_id(staff_id) = private.current_staff_org_id()));


--
-- Name: instructor_class_eligibility instructor_class_eligibility_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instructor_class_eligibility_update_admin ON public.instructor_class_eligibility FOR UPDATE TO authenticated USING (((private.current_staff_role() = 'admin'::text) AND (private.staff_org_id(staff_id) = private.current_staff_org_id()))) WITH CHECK (((private.current_staff_role() = 'admin'::text) AND (private.staff_org_id(staff_id) = private.current_staff_org_id())));


--
-- Name: instructor_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instructor_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: instructor_reviews instructor_reviews_insert_admin_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instructor_reviews_insert_admin_own_org ON public.instructor_reviews FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: instructor_reviews instructor_reviews_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY instructor_reviews_select_same_org ON public.instructor_reviews FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: inventory_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_categories inventory_categories_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_categories_select_same_org ON public.inventory_categories FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements inventory_movements_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_movements_select_admin ON public.inventory_movements FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: kiosk_devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;

--
-- Name: kiosk_devices kiosk_devices_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kiosk_devices_select_admin ON public.kiosk_devices FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = ANY (ARRAY['admin'::text, 'sales_lead'::text]))));


--
-- Name: kiosk_match_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiosk_match_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: Locations locations_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY locations_select_same_org ON public."Locations" FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: maintenance_equipment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_equipment ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_equipment maintenance_equipment_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY maintenance_equipment_select_staff ON public.maintenance_equipment FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: maintenance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_events maintenance_events_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY maintenance_events_select_staff ON public.maintenance_events FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: maintenance_issues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_issues ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_issues maintenance_issues_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY maintenance_issues_select_staff ON public.maintenance_issues FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: maintenance_media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_media ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_media maintenance_media_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY maintenance_media_select_staff ON public.maintenance_media FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: maintenance_vendors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_vendors ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_vendors maintenance_vendors_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY maintenance_vendors_select_staff ON public.maintenance_vendors FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: mbo_autopay_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mbo_autopay_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: mbo_autopay_rows mbo_autopay_rows_insert_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mbo_autopay_rows_insert_club_admin ON public.mbo_autopay_rows FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: mbo_autopay_rows mbo_autopay_rows_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mbo_autopay_rows_select_club_admin ON public.mbo_autopay_rows FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: mbo_autopay_rows mbo_autopay_rows_update_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mbo_autopay_rows_update_club_admin ON public.mbo_autopay_rows FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: member_billing_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_billing_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: member_billing_schedules member_billing_schedules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_billing_schedules_select ON public.member_billing_schedules FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.pos_sales s
  WHERE ((s.id = member_billing_schedules.sale_id) AND (s.staff_id = private.current_staff_id())))))));


--
-- Name: member_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: member_cards member_cards_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_cards_select_sales_team ON public.member_cards FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_contract_sync; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_contract_sync ENABLE ROW LEVEL SECURITY;

--
-- Name: member_contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: member_contracts member_contracts_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_contracts_select_club_admin ON public.member_contracts FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_contracts member_contracts_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_contracts_select_sales_team ON public.member_contracts FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_id_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_id_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: member_personal; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_personal ENABLE ROW LEVEL SECURITY;

--
-- Name: member_personal_edits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_personal_edits ENABLE ROW LEVEL SECURITY;

--
-- Name: member_personal_edits member_personal_edits_insert_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_edits_insert_club_admin ON public.member_personal_edits FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_personal_edits member_personal_edits_insert_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_edits_insert_sales_team ON public.member_personal_edits FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_personal_edits member_personal_edits_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_edits_select_club_admin ON public.member_personal_edits FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_personal member_personal_insert_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_insert_club_admin ON public.member_personal FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_personal member_personal_insert_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_insert_sales_team ON public.member_personal FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_personal member_personal_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_select_club_admin ON public.member_personal FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_personal member_personal_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_select_sales_team ON public.member_personal FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_personal member_personal_update_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_update_club_admin ON public.member_personal FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_personal member_personal_update_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_personal_update_sales_team ON public.member_personal FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members())) WITH CHECK (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_profile_sync; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_profile_sync ENABLE ROW LEVEL SECURITY;

--
-- Name: member_profile_sync member_profile_sync_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_profile_sync_select_club_admin ON public.member_profile_sync FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_profile_sync member_profile_sync_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_profile_sync_select_sales_team ON public.member_profile_sync FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_sale_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_sale_items ENABLE ROW LEVEL SECURITY;

--
-- Name: member_sale_items member_sale_items_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_sale_items_select_club_admin ON public.member_sale_items FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_sale_items member_sale_items_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_sale_items_select_sales_team ON public.member_sale_items FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: member_sales member_sales_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_sales_select_club_admin ON public.member_sales FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_sales member_sales_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_sales_select_sales_team ON public.member_sales FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_services ENABLE ROW LEVEL SECURITY;

--
-- Name: member_services member_services_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_services_select_club_admin ON public.member_services FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_services member_services_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_services_select_sales_team ON public.member_services FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: member_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: member_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: member_visits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: member_visits member_visits_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_visits_select_club_admin ON public.member_visits FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: member_visits member_visits_select_sales_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_visits_select_sales_team ON public.member_visits FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND private.current_staff_sees_members()));


--
-- Name: membership_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_charges membership_charges_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membership_charges_select_admin ON public.membership_charges FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: membership_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_plans membership_plans_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membership_plans_select_club_admin ON public.membership_plans FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: message_boards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_boards ENABLE ROW LEVEL SECURITY;

--
-- Name: message_boards message_boards_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_boards_insert_admin ON public.message_boards FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: message_boards message_boards_select_can_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_boards_select_can_access ON public.message_boards FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((board_type = 'announcements'::text) OR (private.current_staff_role() = 'admin'::text) OR ((board_type = 'team_sales'::text) AND private.current_staff_on_sales_team()) OR ((board_type = 'team_trainers'::text) AND private.current_staff_is_trainer()) OR (EXISTS ( SELECT 1
   FROM public.board_members bm
  WHERE ((bm.board_id = message_boards.id) AND (bm.staff_id = private.current_staff_id()) AND (bm.removed_at IS NULL)))))));


--
-- Name: message_boards message_boards_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_boards_update_admin ON public.message_boards FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: milestone_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.milestone_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: milestone_emails milestone_emails_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY milestone_emails_select ON public.milestone_emails FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (staff_id = ( SELECT staff.id
   FROM public.staff
  WHERE (staff.auth_user_id = auth.uid())
 LIMIT 1)))));


--
-- Name: milestone_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.milestone_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: milestone_templates milestone_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY milestone_templates_select ON public.milestone_templates FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (staff_id = ( SELECT staff.id
   FROM public.staff
  WHERE (staff.auth_user_id = auth.uid())
 LIMIT 1)))));


--
-- Name: mindbody_item_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mindbody_item_types ENABLE ROW LEVEL SECURITY;

--
-- Name: mindbody_item_types mindbody_item_types_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mindbody_item_types_select_same_org ON public.mindbody_item_types FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: newsletter_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletter_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_recipients newsletter_recipients_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY newsletter_recipients_select_admin ON public.newsletter_recipients FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: newsletters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletters ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletters newsletters_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY newsletters_select_admin ON public.newsletters FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: org_modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_modules ENABLE ROW LEVEL SECURITY;

--
-- Name: org_modules org_modules_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_modules_select_same_org ON public.org_modules FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_select_own ON public.organizations FOR SELECT TO authenticated USING ((id = private.current_staff_org_id()));


--
-- Name: organizations organizations_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_update_admin ON public.organizations FOR UPDATE TO authenticated USING (((id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: pay_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pay_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: pay_rates pay_rates_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_rates_select_admin ON public.pay_rates FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: payment_disputes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_disputes payment_disputes_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_disputes_select_admin ON public.payment_disputes FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: payroll_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_events ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_events payroll_events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_events_select ON public.payroll_events FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (staff_id = private.current_staff_id()))));


--
-- Name: payroll_line_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_line_items ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_line_items payroll_line_items_insert_admin_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_line_items_insert_admin_own_org ON public.payroll_line_items FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: payroll_line_items payroll_line_items_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_line_items_select_same_org ON public.payroll_line_items FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: platform_admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_card_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_card_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_items ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_items pos_items_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pos_items_select_same_org ON public.pos_items FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: pos_sale_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_sale_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_sale_lines pos_sale_lines_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pos_sale_lines_select ON public.pos_sale_lines FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.pos_sales s
  WHERE ((s.id = pos_sale_lines.sale_id) AND (s.staff_id = private.current_staff_id())))))));


--
-- Name: pos_sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_sales pos_sales_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pos_sales_select ON public.pos_sales FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (staff_id = private.current_staff_id()))));


--
-- Name: practice_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_charges practice_charges_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_charges_select_admin ON public.practice_charges FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: price_increase_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_increase_items ENABLE ROW LEVEL SECURITY;

--
-- Name: price_increase_items price_increase_items_insert_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_increase_items_insert_club_admin ON public.price_increase_items FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: price_increase_items price_increase_items_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_increase_items_select_club_admin ON public.price_increase_items FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: price_increases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_increases ENABLE ROW LEVEL SECURITY;

--
-- Name: price_increases price_increases_insert_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_increases_insert_club_admin ON public.price_increases FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: price_increases price_increases_select_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_increases_select_club_admin ON public.price_increases FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: price_increases price_increases_update_club_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_increases_update_club_admin ON public.price_increases FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: promo_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_codes promo_codes_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_codes_select_admin ON public.promo_codes FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_own_row; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own_row ON public.push_subscriptions TO authenticated USING ((staff_id = private.current_staff_id())) WITH CHECK ((staff_id = private.current_staff_id()));


--
-- Name: rate_limit_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: rating_opt_outs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rating_opt_outs ENABLE ROW LEVEL SECURITY;

--
-- Name: rating_opt_outs rating_opt_outs_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rating_opt_outs_select_admin ON public.rating_opt_outs FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: rating_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rating_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: rating_requests rating_requests_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rating_requests_select_admin ON public.rating_requests FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: report_imports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_imports ENABLE ROW LEVEL SECURITY;

--
-- Name: report_imports report_imports_insert_admin_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_imports_insert_admin_own_org ON public.report_imports FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: report_imports report_imports_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_imports_select_same_org ON public.report_imports FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: report_imports report_imports_update_admin_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_imports_update_admin_own_org ON public.report_imports FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: revenue_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.revenue_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: revenue_categories revenue_categories_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY revenue_categories_select_same_org ON public.revenue_categories FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: revenue_line_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.revenue_line_items ENABLE ROW LEVEL SECURITY;

--
-- Name: revenue_line_items revenue_line_items_insert_admin_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY revenue_line_items_insert_admin_own_org ON public.revenue_line_items FOR INSERT TO authenticated WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: revenue_line_items revenue_line_items_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY revenue_line_items_select_same_org ON public.revenue_line_items FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: room_layouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_layouts ENABLE ROW LEVEL SECURITY;

--
-- Name: room_layouts room_layouts_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY room_layouts_select_same_org ON public.room_layouts FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: rooms rooms_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rooms_select_same_org ON public.rooms FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: sale_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_items sale_items_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sale_items_select_same_org ON public.sale_items FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

--
-- Name: sales sales_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sales_select_same_org ON public.sales FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: session_pack_uses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_pack_uses ENABLE ROW LEVEL SECURITY;

--
-- Name: session_pack_uses session_pack_uses_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_pack_uses_select_same_org ON public.session_pack_uses FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: session_packs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_packs ENABLE ROW LEVEL SECURITY;

--
-- Name: session_packs session_packs_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_packs_select_same_org ON public.session_packs FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: session_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_types ENABLE ROW LEVEL SECURITY;

--
-- Name: session_types session_types_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_types_select_same_org ON public.session_types FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: staff; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_pay_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_pay_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_pay_assignments staff_pay_assignments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_pay_assignments_select ON public.staff_pay_assignments FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (staff_id = private.current_staff_id()))));


--
-- Name: staff_pay_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_pay_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_pay_settings staff_pay_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_pay_settings_select ON public.staff_pay_settings FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((private.current_staff_role() = 'admin'::text) OR (staff_id = private.current_staff_id()))));


--
-- Name: staff staff_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_select_same_org ON public.staff FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: staff_sync_exclusions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_sync_exclusions ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_sync_exclusions staff_sync_exclusions_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_sync_exclusions_select_same_org ON public.staff_sync_exclusions FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: stripe_connect_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_connect_events ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_connected_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_connected_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_connected_accounts stripe_connected_accounts_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stripe_connected_accounts_select_admin ON public.stripe_connected_accounts FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: stripe_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

--
-- Name: studio_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.studio_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: substitution_interests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.substitution_interests ENABLE ROW LEVEL SECURITY;

--
-- Name: substitution_interests substitution_interests_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY substitution_interests_insert_own ON public.substitution_interests FOR INSERT TO authenticated WITH CHECK (((staff_id = private.current_staff_id()) AND (EXISTS ( SELECT 1
   FROM public.substitution_requests r
  WHERE ((r.id = substitution_interests.request_id) AND (r.organization_id = private.current_staff_org_id()))))));


--
-- Name: substitution_interests substitution_interests_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY substitution_interests_select_same_org ON public.substitution_interests FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.substitution_requests r
  WHERE ((r.id = substitution_interests.request_id) AND (r.organization_id = private.current_staff_org_id())))));


--
-- Name: substitution_interests substitution_interests_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY substitution_interests_update_own ON public.substitution_interests FOR UPDATE TO authenticated USING ((staff_id = private.current_staff_id())) WITH CHECK ((staff_id = private.current_staff_id()));


--
-- Name: substitution_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.substitution_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: substitution_requests substitution_requests_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY substitution_requests_insert_own ON public.substitution_requests FOR INSERT TO authenticated WITH CHECK (((requested_by = private.current_staff_id()) AND (organization_id = private.current_staff_org_id())));


--
-- Name: substitution_requests substitution_requests_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY substitution_requests_select_same_org ON public.substitution_requests FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: substitution_requests substitution_requests_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY substitution_requests_update_admin ON public.substitution_requests FOR UPDATE TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text))) WITH CHECK (((organization_id = private.current_staff_org_id()) AND (private.current_staff_role() = 'admin'::text)));


--
-- Name: substitution_requests substitution_requests_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY substitution_requests_update_own ON public.substitution_requests FOR UPDATE TO authenticated USING (((requested_by = private.current_staff_id()) AND (organization_id = private.current_staff_org_id()))) WITH CHECK (((requested_by = private.current_staff_id()) AND (organization_id = private.current_staff_org_id())));


--
-- Name: sync_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_state sync_state_select_same_org_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_state_select_same_org_admin ON public.sync_state FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (EXISTS ( SELECT 1
   FROM public.staff
  WHERE ((staff.auth_user_id = auth.uid()) AND (staff.organization_id = sync_state.organization_id) AND (staff.role = 'admin'::text))))));


--
-- Name: terminal_readers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.terminal_readers ENABLE ROW LEVEL SECURITY;

--
-- Name: terminal_readers terminal_readers_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY terminal_readers_select_same_org ON public.terminal_readers FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: time_punch_edits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.time_punch_edits ENABLE ROW LEVEL SECURITY;

--
-- Name: time_punch_edits time_punch_edits_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_punch_edits_select_admin ON public.time_punch_edits FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND (EXISTS ( SELECT 1
   FROM public.staff
  WHERE ((staff.auth_user_id = auth.uid()) AND (staff.role = 'admin'::text))))));


--
-- Name: time_punches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.time_punches ENABLE ROW LEVEL SECURITY;

--
-- Name: time_punches time_punches_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_punches_select_own_or_admin ON public.time_punches FOR SELECT TO authenticated USING (((organization_id = private.current_staff_org_id()) AND ((staff_id = ( SELECT staff.id
   FROM public.staff
  WHERE (staff.auth_user_id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM public.staff
  WHERE ((staff.auth_user_id = auth.uid()) AND (staff.role = 'admin'::text)))))));


--
-- Name: trainer_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trainer_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: trainer_availability trainer_availability_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trainer_availability_select_same_org ON public.trainer_availability FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: trainer_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trainer_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: trainer_sessions trainer_sessions_select_same_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trainer_sessions_select_same_org ON public.trainer_sessions FOR SELECT TO authenticated USING ((organization_id = private.current_staff_org_id()));


--
-- Name: waiver_signatures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waiver_signatures ENABLE ROW LEVEL SECURITY;

--
-- Name: waiver_signatures waiver_signatures_select_assigned_trainer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waiver_signatures_select_assigned_trainer ON public.waiver_signatures FOR SELECT TO authenticated USING (private.is_assigned_trainer(contact_id));


--
-- Name: waiver_signatures waiver_signatures_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waiver_signatures_select_crm ON public.waiver_signatures FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- Name: waiver_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waiver_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: waiver_templates waiver_templates_select_crm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waiver_templates_select_crm ON public.waiver_templates FOR SELECT TO authenticated USING (private.can_read_crm(organization_id));


--
-- PostgreSQL database dump complete
--


