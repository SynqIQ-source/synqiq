-- Class ratings. The first class a member takes with an instructor each
-- calendar quarter brings one email asking them to rate it (stars + an
-- optional comment; more questions can be added later in `answers`).
-- Instructors see their own ratings without names; Club Admins see all,
-- with names. At most 2 rating emails a week per member.

create table if not exists rating_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  client_name text,
  staff_id uuid not null references staff (id),
  class_occurrence_id uuid references class_occurrences (id) on delete set null,
  class_name text not null,
  class_style text not null, -- class type name, for "by class style"
  class_start timestamptz not null,
  quarter text not null, -- '2026-Q4'
  status text not null default 'queued' check (status in ('queued', 'sent', 'rated', 'expired', 'skipped')),
  skip_reason text,
  token_hash text unique,
  sent_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, mindbody_client_id, staff_id, quarter)
);
create index if not exists rating_requests_status_idx on rating_requests (organization_id, status, class_start);
create index if not exists rating_requests_client_idx on rating_requests (organization_id, mindbody_client_id, sent_at);

create table if not exists class_ratings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  request_id uuid not null unique references rating_requests (id) on delete cascade,
  staff_id uuid not null references staff (id),
  mindbody_client_id text not null,
  client_name text,
  class_name text not null,
  class_style text not null,
  class_start timestamptz not null,
  quarter text not null,
  stars smallint not null check (stars between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  answers jsonb not null default '{}'::jsonb, -- future extra questions
  created_at timestamptz not null default now()
);
create index if not exists class_ratings_staff_idx on class_ratings (organization_id, staff_id, quarter);
create index if not exists class_ratings_quarter_idx on class_ratings (organization_id, quarter);

-- Members who asked not to get rating emails.
create table if not exists rating_opt_outs (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, mindbody_client_id)
);

-- off | testers (only member-portal testers get emails) | everyone
alter table organizations add column if not exists ratings_mode text not null default 'testers';
alter table organizations drop constraint if exists organizations_ratings_mode_check;
alter table organizations add constraint organizations_ratings_mode_check check (ratings_mode in ('off', 'testers', 'everyone'));

alter table rating_requests enable row level security;
alter table class_ratings enable row level security;
alter table rating_opt_outs enable row level security;

-- Club Admins see everything; an instructor sees only their own ratings
-- through the server (which drops names). No direct reads of who rated.
drop policy if exists "rating_requests_select_admin" on rating_requests;
create policy "rating_requests_select_admin" on rating_requests for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "class_ratings_select_admin" on class_ratings;
create policy "class_ratings_select_admin" on class_ratings for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "rating_opt_outs_select_admin" on rating_opt_outs;
create policy "rating_opt_outs_select_admin" on rating_opt_outs for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
