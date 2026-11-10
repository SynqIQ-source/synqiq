-- SynqIQ's own billing edits to a member's dues: credits, one-time or
-- ongoing discounts, freezes. Until the switch they don't change what
-- Mindbody charges; shadow billing shows them as planned changes. Each row
-- is its own audit record (who made it, when, why; who cancelled it).
-- Club Admins only.
create table if not exists billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  member_contract_id uuid references member_contracts (id) on delete set null, -- null = all the member's contracts
  kind text not null check (kind in ('credit', 'discount_once', 'discount_ongoing', 'freeze')),
  amount_cents integer check (amount_cents is null or amount_cents > 0),
  percent numeric(5, 2) check (percent is null or (percent > 0 and percent <= 100)),
  starts_on date not null,
  ends_on date,
  reason text not null check (length(trim(reason)) > 0),
  created_by_staff_id uuid not null references staff (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_staff_id uuid references staff (id),
  cancel_reason text,
  check (ends_on is null or ends_on >= starts_on),
  check (
    (kind = 'credit' and amount_cents is not null and percent is null)
    or (kind in ('discount_once', 'discount_ongoing') and ((amount_cents is null) <> (percent is null)))
    or (kind = 'freeze' and amount_cents is null and percent is null and ends_on is not null)
  )
);

create index if not exists billing_adjustments_client_idx on billing_adjustments (organization_id, mindbody_client_id);

alter table billing_adjustments enable row level security;

create policy "billing_adjustments_select_club_admin" on billing_adjustments for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "billing_adjustments_insert_club_admin" on billing_adjustments for insert to authenticated
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "billing_adjustments_update_club_admin" on billing_adjustments for update to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin')
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
