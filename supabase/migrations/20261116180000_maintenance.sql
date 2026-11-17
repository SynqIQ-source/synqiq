-- Maintenance module: an equipment register, vendors, issue reports with a
-- timeline (notes, troubleshooting, vendor emails in and out, visits, quotes
-- and payments) and photos / short videos in a private bucket.
--
-- Staff of the studio can read everything (visibility); every write goes
-- through the API with the service role after the role checks there
-- (report: any staff; notes: any staff; status / visits / resolve: the
-- equipment's owner or a Club Admin; vendors, contacting a vendor, quotes
-- and payments: Club Admins).

create table if not exists maintenance_vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  email text,
  phone text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists maintenance_vendors_org_idx on maintenance_vendors (organization_id);

create table if not exists maintenance_equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  area text,
  model_number text,
  serial_number text,
  is_critical boolean not null default false,
  owner_staff_id uuid references staff(id) on delete set null,
  default_vendor_id uuid references maintenance_vendors(id) on delete set null,
  notes text,
  -- For QR stickers later (scan to report this piece).
  qr_token text unique default encode(gen_random_bytes(9), 'hex'),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists maintenance_equipment_org_idx on maintenance_equipment (organization_id);

create table if not exists maintenance_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  equipment_id uuid references maintenance_equipment(id) on delete set null,
  -- When it isn't in the register ("Women's locker room sink").
  location_text text,
  title text not null,
  description text not null,
  is_critical boolean not null default false,
  status text not null default 'reported'
    check (status in ('reported', 'troubleshooting', 'vendor_contacted', 'vendor_replied', 'visit_scheduled', 'on_site', 'resolved')),
  reported_by_staff_id uuid references staff(id) on delete set null,
  vendor_id uuid references maintenance_vendors(id) on delete set null,
  vendor_approved_by_staff_id uuid references staff(id) on delete set null,
  vendor_approved_at timestamptz,
  vendor_contacted_at timestamptz,
  last_vendor_reply_at timestamptz,
  -- Per-issue reply address (m-<token>@relay domain): vendor replies land here.
  email_alias text unique,
  last_message_id text,
  next_visit_at timestamptz,
  resolved_at timestamptz,
  resolved_by_staff_id uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists maintenance_issues_org_status_idx on maintenance_issues (organization_id, status);
create index if not exists maintenance_issues_equipment_idx on maintenance_issues (equipment_id);

create table if not exists maintenance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  issue_id uuid not null references maintenance_issues(id) on delete cascade,
  kind text not null
    check (kind in ('reported', 'note', 'troubleshooting', 'status', 'vendor_out', 'vendor_in', 'visit', 'quote', 'paid', 'resolved', 'reopened')),
  body text,
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  visit_at timestamptz,
  status text,
  staff_id uuid references staff(id) on delete set null,
  vendor_id uuid references maintenance_vendors(id) on delete set null,
  from_email text,
  subject text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index if not exists maintenance_events_issue_idx on maintenance_events (issue_id, created_at);

create table if not exists maintenance_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  issue_id uuid not null references maintenance_issues(id) on delete cascade,
  kind text not null check (kind in ('photo', 'video')),
  path text not null unique,
  content_type text not null,
  size_bytes bigint not null,
  duration_seconds numeric,
  uploaded_by_staff_id uuid references staff(id) on delete set null,
  uploaded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists maintenance_media_issue_idx on maintenance_media (issue_id);

alter table maintenance_vendors enable row level security;
alter table maintenance_equipment enable row level security;
alter table maintenance_issues enable row level security;
alter table maintenance_events enable row level security;
alter table maintenance_media enable row level security;

drop policy if exists "maintenance_vendors_select_staff" on maintenance_vendors;
create policy "maintenance_vendors_select_staff" on maintenance_vendors for select to authenticated
  using (organization_id = private.current_staff_org_id());
drop policy if exists "maintenance_equipment_select_staff" on maintenance_equipment;
create policy "maintenance_equipment_select_staff" on maintenance_equipment for select to authenticated
  using (organization_id = private.current_staff_org_id());
drop policy if exists "maintenance_issues_select_staff" on maintenance_issues;
create policy "maintenance_issues_select_staff" on maintenance_issues for select to authenticated
  using (organization_id = private.current_staff_org_id());
drop policy if exists "maintenance_events_select_staff" on maintenance_events;
create policy "maintenance_events_select_staff" on maintenance_events for select to authenticated
  using (organization_id = private.current_staff_org_id());
drop policy if exists "maintenance_media_select_staff" on maintenance_media;
create policy "maintenance_media_select_staff" on maintenance_media for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- Private: the server hands out signed upload and view links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maintenance-media', 'maintenance-media', false, 52428800,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
