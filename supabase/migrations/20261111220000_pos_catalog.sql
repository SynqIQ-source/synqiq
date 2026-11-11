-- POS, part 1: what can be sold.
--
-- revenue_categories: the studio's revenue categories (chart of accounts).
-- Each item belongs to one; the category decides whether the item is taxed
-- (an item can override) and which ledger account its revenue posts to.
--
-- pos_items: everything the checkout can sell -- retail products, packs and
-- services, memberships. Imported read-only from Mindbody (active items
-- only), then edited in SynqIQ: a later import refreshes the mindbody_* copy
-- but never overwrites SynqIQ's name, price, category or picture.
--
-- pos-images: public bucket for item pictures shown on the checkout cards.

alter table organizations add column if not exists sales_tax_rate numeric(8, 6) not null default 0.0825
  check (sales_tax_rate >= 0 and sales_tax_rate < 1);

create table if not exists revenue_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  taxable boolean not null default false,
  gl_account text check (gl_account is null or char_length(gl_account) <= 40), -- chart of accounts code
  sort integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table if not exists pos_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  kind text not null check (kind in ('product', 'service', 'membership')),
  source text not null default 'mindbody' check (source in ('mindbody', 'synqiq')),
  mindbody_id text, -- product ProductId / pricing option Id / contract id
  name text not null check (char_length(name) between 1 and 200),
  price_cents integer not null default 0 check (price_cents >= 0),
  revenue_category_id uuid references revenue_categories (id),
  taxable boolean, -- null = the category decides
  barcode text check (barcode is null or char_length(barcode) <= 64),
  image_url text,
  sessions integer, -- packs: sessions included (very large = unlimited)
  active boolean not null default true,
  sort integer not null default 0,
  mindbody_name text,
  mindbody_price_cents integer,
  mindbody_tax_rate numeric(8, 6),
  mindbody_group text, -- Mindbody program / revenue category / product category, for reference
  mindbody_discontinued boolean,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff (id),
  unique (organization_id, kind, mindbody_id)
);
create index if not exists pos_items_org_idx on pos_items (organization_id, active, revenue_category_id);
create index if not exists pos_items_barcode_idx on pos_items (organization_id, barcode) where barcode is not null;

alter table revenue_categories enable row level security;
alter table pos_items enable row level security;

-- Every staff member at the studio can see what's for sale (checkout);
-- changes go through the API (Club Admin).
drop policy if exists "revenue_categories_select_same_org" on revenue_categories;
create policy "revenue_categories_select_same_org" on revenue_categories for select to authenticated
  using (organization_id = private.current_staff_org_id());
drop policy if exists "pos_items_select_same_org" on pos_items;
create policy "pos_items_select_same_org" on pos_items for select to authenticated
  using (organization_id = private.current_staff_org_id());

insert into storage.buckets (id, name, public)
values ('pos-images', 'pos-images', true)
on conflict (id) do nothing;

drop policy if exists "pos_images_select_public" on storage.objects;
create policy "pos_images_select_public" on storage.objects for select to public
  using (bucket_id = 'pos-images');
