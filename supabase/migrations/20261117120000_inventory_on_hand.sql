-- Inventory on hand for retail products (Products & Inventory -> Inventory on
-- hand). Club Admins set each product's PAR (the level to stock back up to)
-- and reorder level (order when on hand falls to it), log counts (starting
-- inventory or a recount) and deliveries received. On hand = the latest count
-- + received since - sold since (completed checkout sales), computed in the
-- app (lib/pos/inventory.ts).

alter table pos_items add column if not exists par_level integer check (par_level is null or par_level between 0 and 100000);
alter table pos_items add column if not exists reorder_level integer check (reorder_level is null or reorder_level between 0 and 100000);

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  pos_item_id uuid not null references pos_items (id) on delete cascade,
  kind text not null check (kind in ('count', 'received')),
  quantity integer not null check (quantity between 0 and 100000),
  note text check (note is null or char_length(note) <= 500),
  staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  check (kind = 'count' or quantity > 0)
);
create index if not exists inventory_movements_item_idx on inventory_movements (pos_item_id, created_at);
create index if not exists inventory_movements_org_idx on inventory_movements (organization_id, created_at);

-- Club Admins of the studio read them; writes go through the server.
alter table inventory_movements enable row level security;
drop policy if exists "inventory_movements_select_admin" on inventory_movements;
create policy "inventory_movements_select_admin" on inventory_movements for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
