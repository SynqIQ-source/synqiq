-- Who earns commission on a sale line is chosen, not inferred: at checkout
-- (SynqIQ POS, later), from the Mindbody commission report during the
-- parallel run (import), or by a Club Admin (manual). A line can be split
-- between people by share. "None" (no_commission on the line's flag) means
-- nobody earns on it. Mindbody's API only names whoever rang up the sale, so
-- that is no longer used to pay commission.

create table if not exists commission_sale_credits (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_sale_detail_id bigint not null,
  staff_id uuid not null references staff (id) on delete cascade,
  share_percent numeric(5, 2) not null default 100 check (share_percent > 0 and share_percent <= 100),
  source text not null default 'manual' check (source in ('import', 'manual', 'pos')),
  set_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  primary key (organization_id, mindbody_sale_detail_id, staff_id)
);
create index if not exists commission_sale_credits_staff_idx on commission_sale_credits (organization_id, staff_id);

alter table commission_sale_flags add column if not exists no_commission boolean not null default false;
alter table commission_lines add column if not exists share_percent numeric(5, 2) not null default 100;

alter table commission_sale_credits enable row level security;
drop policy if exists "commission_sale_credits_select" on commission_sale_credits;
create policy "commission_sale_credits_select" on commission_sale_credits for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or staff_id = private.current_staff_id())
  );
