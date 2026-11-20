-- Card readers at the desk (Stripe Terminal smart readers such as the WisePOS E
-- or S700). Server-driven: SynqIQ tells the reader what to charge over the
-- internet, so it works from any browser, iPads included. Readers live in the
-- studio's own Stripe account (one location per studio per mode).
create table if not exists terminal_readers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  livemode boolean not null,
  stripe_account_id text not null,
  stripe_location_id text not null,
  stripe_reader_id text not null unique,
  label text not null,
  device_type text,
  serial_number text,
  registered_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists terminal_readers_org_idx on terminal_readers (organization_id, livemode) where removed_at is null;

-- Which reader a card payment went to (null = Stripe's card form).
alter table pos_card_payments add column if not exists stripe_reader_id text;

alter table terminal_readers enable row level security;
drop policy if exists terminal_readers_select_same_org on terminal_readers;
create policy terminal_readers_select_same_org on terminal_readers for select to authenticated
  using (organization_id = private.current_staff_org_id());
