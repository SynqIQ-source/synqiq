-- Newsletters for current and former members (Adam, 2026-11-19): most
-- members only exist in Mindbody, not the CRM, so SynqIQ had no email opt-in
-- for them. The nightly client sync now copies Mindbody's own "send
-- promotional emails" setting (read-only; nothing is written to Mindbody),
-- and keeps the email address of current/former members who said yes.
alter table clients add column if not exists email_promotions boolean;

-- Recipients can now be a CRM contact or a Mindbody client (no recipients
-- have been sent yet, so the key can change safely).
alter table newsletter_recipients drop constraint if exists newsletter_recipients_pkey;
alter table newsletter_recipients add column if not exists id uuid not null default gen_random_uuid();
alter table newsletter_recipients add primary key (id);
alter table newsletter_recipients alter column contact_id drop not null;
alter table newsletter_recipients add column if not exists client_id uuid references clients (id) on delete cascade;
alter table newsletter_recipients drop constraint if exists newsletter_recipients_person_check;
alter table newsletter_recipients add constraint newsletter_recipients_person_check check (contact_id is not null or client_id is not null);
create unique index if not exists newsletter_recipients_email_idx on newsletter_recipients (newsletter_id, lower(email));

drop function if exists public.newsletter_audience(uuid, jsonb);
drop function if exists private.newsletter_audience(uuid, jsonb);

-- Who a newsletter goes to (filters: see 20261120130000_newsletters.sql).
-- Two sources, one row per email address:
--   1. CRM contacts (leads, guests, members) who opted in to email.
--   2. Current and former members from Mindbody who opted in to promotional
--      emails there and aren't in the CRM (the CRM's choice wins when they are).
-- Either way: never an address on the studio's unsubscribe list.
create or replace function private.newsletter_audience(p_org uuid, p_filters jsonb)
returns table (contact_id uuid, client_id uuid, email text, first_name text)
language sql
stable
security definer
set search_path = public
as $$
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
$$;

create or replace function public.newsletter_audience(p_org uuid, p_filters jsonb)
returns table (contact_id uuid, client_id uuid, email text, first_name text)
language sql
stable
security definer
set search_path = public
as $$ select * from private.newsletter_audience(p_org, p_filters) $$;

revoke all on function private.newsletter_audience(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.newsletter_audience(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.newsletter_audience(uuid, jsonb) to service_role;
