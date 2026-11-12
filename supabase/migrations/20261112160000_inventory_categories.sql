-- Inventory categories: how the studio organizes Products & Inventory --
-- category cards (Membership Packages, Drinks, ...), then sub-category cards
-- (Drinks -> Energy drinks, Water, Electrolytes), then the items. Named and
-- arranged by the studio; two levels. Organizing only: tax and accounting
-- still come from each item's revenue category (Water items in Drinks still
-- post to the untaxed Water category). The POS tab will mirror this later.

create table if not exists inventory_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  parent_id uuid references inventory_categories (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inventory_categories_org_idx on inventory_categories (organization_id, parent_id, sort);

alter table pos_items add column if not exists inventory_category_id uuid references inventory_categories (id) on delete set null;

alter table inventory_categories enable row level security;
drop policy if exists "inventory_categories_select_same_org" on inventory_categories;
create policy "inventory_categories_select_same_org" on inventory_categories for select to authenticated
  using (organization_id = private.current_staff_org_id());
