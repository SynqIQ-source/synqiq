-- Admin > Email > Newsletters (Adam, 2026-11-19): Club Admins write an email,
-- pick who gets it (leads / guests / members, member status, lead source,
-- created date, last visit, "hasn't visited in N days"), send a test to
-- themselves, and schedule it. Only contacts who opted in to email
-- (crm_contacts.email_consent) and haven't unsubscribed are ever included.
create table if not exists newsletters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  subject text not null default '' check (length(subject) <= 200),
  body text not null default '' check (length(body) <= 20000),
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_for timestamptz,
  started_at timestamptz,
  sent_at timestamptz,
  recipient_count integer,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_by_staff_id uuid references staff (id),
  scheduled_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists newsletters_org_idx on newsletters (organization_id, created_at desc);
create index if not exists newsletters_due_idx on newsletters (scheduled_for) where status = 'scheduled';

create table if not exists newsletter_recipients (
  newsletter_id uuid not null references newsletters (id) on delete cascade,
  contact_id uuid not null references crm_contacts (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  email text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  unsubscribe_token_hash text not null unique,
  sent_at timestamptz,
  unsubscribed_at timestamptz,
  primary key (newsletter_id, contact_id)
);

-- Unsubscribed addresses, per studio. Also turns off the contact's email
-- consent; kept separately so a re-imported contact stays unsubscribed.
create table if not exists email_unsubscribes (
  organization_id uuid not null references organizations (id) on delete cascade,
  email_normalized text not null,
  newsletter_id uuid references newsletters (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, email_normalized)
);

alter table newsletters enable row level security;
alter table newsletter_recipients enable row level security;
alter table email_unsubscribes enable row level security;
drop policy if exists newsletters_select_admin on newsletters;
create policy newsletters_select_admin on newsletters for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists newsletter_recipients_select_admin on newsletter_recipients;
create policy newsletter_recipients_select_admin on newsletter_recipients for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists email_unsubscribes_select_admin on email_unsubscribes;
create policy email_unsubscribes_select_admin on email_unsubscribes for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

-- Who a newsletter goes to. filters (all optional):
--   types: ["lead","guest","member"]          (default: all three)
--   member_status: ["active","cancelled","frozen"] (members only)
--   sources: ["walk_in","web",...]
--   created_from / created_to: "YYYY-MM-DD"
--   visited_from / visited_to: "YYYY-MM-DD"   (last visit in range)
--   not_visited_days: N                       (no visit in the last N days, or never)
-- Member status comes from Mindbody (Active / Suspended / ended) and SynqIQ
-- billing (a frozen or past-due schedule counts as frozen).
-- Last visit: Mindbody visits signed in, guest visits, and SynqIQ check-ins.
create or replace function private.newsletter_audience(p_org uuid, p_filters jsonb)
returns table (contact_id uuid, email text, first_name text)
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
  base as (
    select c.id, c.email, c.email_normalized, c.first_name, c.status, c.source, c.created_at, c.mindbody_client_id
    from crm_contacts c
    where c.organization_id = p_org
      and c.deleted_at is null
      and c.merged_into_id is null
      and c.email_consent
      and c.email is not null
      and c.email_normalized is not null
      and c.status in ('lead', 'guest', 'member')
      and not exists (
        select 1 from email_unsubscribes u where u.organization_id = p_org and u.email_normalized = c.email_normalized
      )
  ),
  enriched as (
    select
      b.*,
      case
        when b.status <> 'member' then null
        when exists (
          select 1 from member_billing_schedules s
          where s.organization_id = p_org and s.mindbody_client_id = b.mindbody_client_id and s.billing_state in ('past_due', 'frozen')
        ) then 'frozen'
        when cl.status = 'Suspended' then 'frozen'
        when cl.status = 'Active' then 'active'
        else 'cancelled'
      end as member_status,
      greatest(
        (select max(v.start_local) from member_visits v
          where v.organization_id = p_org and v.mindbody_client_id = b.mindbody_client_id and v.signed_in and b.mindbody_client_id is not null)::date,
        (select max(g.visit_at) from guest_visits g where g.organization_id = p_org and g.contact_id = b.id)::date,
        (select max(ci.checked_in_at) from check_ins ci
          where ci.organization_id = p_org and ci.mindbody_client_id = b.mindbody_client_id and ci.voided_at is null and b.mindbody_client_id is not null)::date
      ) as last_visit
    from base b
    left join clients cl on cl.organization_id = p_org and cl.mindbody_client_id = b.mindbody_client_id
  )
  select distinct on (e.email_normalized) e.id, e.email, e.first_name
  from enriched e, params p
  where (cardinality(p.types) = 0 or e.status = any (p.types))
    and (cardinality(p.member_status) = 0 or e.status <> 'member' or e.member_status = any (p.member_status))
    and (cardinality(p.sources) = 0 or e.source = any (p.sources))
    and (p.created_from is null or e.created_at::date >= p.created_from)
    and (p.created_to is null or e.created_at::date <= p.created_to)
    and (p.visited_from is null or e.last_visit >= p.visited_from)
    and (p.visited_to is null or e.last_visit <= p.visited_to)
    and (p.not_visited_days is null or e.last_visit is null or e.last_visit < current_date - p.not_visited_days)
  order by e.email_normalized, e.created_at desc
$$;

create or replace function public.newsletter_audience(p_org uuid, p_filters jsonb)
returns table (contact_id uuid, email text, first_name text)
language sql
stable
security definer
set search_path = public
as $$ select * from private.newsletter_audience(p_org, p_filters) $$;

revoke all on function private.newsletter_audience(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.newsletter_audience(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.newsletter_audience(uuid, jsonb) to service_role;
