-- POS, part 2: checkout. Until payments are connected every sale is a
-- PRACTICE sale (status 'practice'): it records exactly what would have been
-- sold, with tax, discounts and commission choices, but no money moves.
-- payment_method/payment_ref are where Stripe Terminal / card on file plug in.

create table if not exists promo_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{2,30}$'),
  kind text not null check (kind in ('percent', 'amount')),
  percent numeric(5, 2) check (percent is null or (percent > 0 and percent <= 100)),
  amount_cents integer check (amount_cents is null or amount_cents > 0),
  revenue_category_ids uuid[], -- null = every item
  starts_on date,
  ends_on date,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  created_by_staff_id uuid references staff (id),
  check ((kind = 'percent' and percent is not null) or (kind = 'amount' and amount_cents is not null))
);
create unique index if not exists promo_codes_org_code_idx on promo_codes (organization_id, code) where active;

create table if not exists pos_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  sale_number bigint generated always as identity,
  status text not null default 'practice' check (status in ('practice', 'completed', 'voided')),
  mindbody_client_id text, -- null = walk-in
  client_name text,
  staff_id uuid not null references staff (id), -- rang it up
  subtotal_cents integer not null,
  discount_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null,
  tax_rate numeric(8, 6) not null,
  promo_code_id uuid references promo_codes (id),
  promo_code text,
  payment_method text not null default 'practice', -- later: card_present, card_on_file, cash, account
  payment_ref text,
  note text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by_staff_id uuid references staff (id),
  void_reason text
);
create index if not exists pos_sales_org_created_idx on pos_sales (organization_id, created_at desc);

create table if not exists pos_sale_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  sale_id uuid not null references pos_sales (id) on delete cascade,
  pos_item_id uuid references pos_items (id),
  name text not null,
  kind text not null,
  revenue_category_id uuid references revenue_categories (id),
  revenue_category text,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null,
  discount_cents integer not null default 0, -- manual + promo, for the whole line
  taxable boolean not null,
  tax_cents integer not null default 0,
  total_cents integer not null, -- after discounts, with tax
  commission_credits jsonb not null default '[]'::jsonb, -- [{staffId, share}] chosen at checkout
  no_commission boolean not null default false, -- "None" chosen at checkout
  line_number integer not null
);
create index if not exists pos_sale_lines_sale_idx on pos_sale_lines (sale_id);

alter table promo_codes enable row level security;
alter table pos_sales enable row level security;
alter table pos_sale_lines enable row level security;

-- Club Admins see every sale and promo code; others see the sales they rang up.
drop policy if exists "promo_codes_select_admin" on promo_codes;
create policy "promo_codes_select_admin" on promo_codes for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "pos_sales_select" on pos_sales;
create policy "pos_sales_select" on pos_sales for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or staff_id = private.current_staff_id())
  );
drop policy if exists "pos_sale_lines_select" on pos_sale_lines;
create policy "pos_sale_lines_select" on pos_sale_lines for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (
      private.current_staff_role() = 'admin'
      or exists (select 1 from pos_sales s where s.id = sale_id and s.staff_id = private.current_staff_id())
    )
  );
