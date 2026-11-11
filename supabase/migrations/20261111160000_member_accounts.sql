-- L2: member accounts (password sign-in) for booking on the studio's
-- website, separate from staff sign-in (Supabase Auth). Members are
-- matched to the studio's clients by email. Only the server (service role)
-- touches these tables: RLS is on with no policies, so no signed-in staff
-- or member token can read password hashes or sessions.
--
-- During the parallel run (member_portal_mode = 'testers') only clients a
-- Club Admin adds to member_portal_testers can create an account, get an
-- email, or sign in. 'open' is for the switch; 'off' hides it.

alter table organizations add column if not exists member_portal_mode text not null default 'testers'
  check (member_portal_mode in ('off', 'testers', 'open'));

create table if not exists member_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  email text not null, -- lower-case
  password_hash text,  -- scrypt; null until they set one from the emailed link
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_sign_in_at timestamptz,
  password_set_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, mindbody_client_id),
  unique (organization_id, email)
);

create table if not exists member_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references member_accounts (id) on delete cascade,
  token_hash text not null unique, -- sha256 of the cookie value
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent text
);
create index if not exists member_sessions_account_idx on member_sessions (account_id);

-- One-time links to set or reset a password (sha256 of the token in the link).
create table if not exists member_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references member_accounts (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists member_tokens_account_idx on member_tokens (account_id, created_at desc);

create table if not exists member_portal_testers (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  client_name text not null,
  added_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  primary key (organization_id, mindbody_client_id)
);

alter table member_accounts enable row level security;
alter table member_sessions enable row level security;
alter table member_tokens enable row level security;
alter table member_portal_testers enable row level security;
create policy "member_portal_testers_select_admin" on member_portal_testers for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- Who booked or cancelled: staff or the member themselves.
alter table class_bookings add column if not exists booked_by_member_account_id uuid references member_accounts (id);
alter table class_bookings add column if not exists cancelled_by_member_account_id uuid references member_accounts (id);
