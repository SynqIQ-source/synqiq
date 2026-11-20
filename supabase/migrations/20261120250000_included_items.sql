-- "What's included" (Adam, 2026-11-19): each studio names what its memberships
-- and passes can include (gym access, group classes, Group Reformer, towels,
-- recovery...). Memberships get the studio's default set; any pricing option
-- (a Mindbody product, or an item sold in SynqIQ) can have its own ticks; each
-- class category needs one item. Booking checks: does something current on the
-- client's account include what this class's category needs? Packs keep
-- covering their own category. Seeded so every result equals today's
-- "included in membership" switches.
create table if not exists included_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists included_items_name_key on included_items (organization_id, lower(name));

create table if not exists included_item_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  item_id uuid not null references included_items (id) on delete cascade,
  mindbody_product_id text,
  pos_item_id uuid references pos_items (id) on delete cascade,
  check ((mindbody_product_id is not null) <> (pos_item_id is not null))
);
create unique index if not exists included_item_grants_product_key on included_item_grants (organization_id, item_id, mindbody_product_id);
create unique index if not exists included_item_grants_pos_key on included_item_grants (organization_id, item_id, pos_item_id);

alter table organizations add column if not exists membership_default_items uuid[] not null default '{}';
alter table departments add column if not exists required_item_id uuid references included_items (id) on delete set null;

alter table included_items enable row level security;
alter table included_item_grants enable row level security;
drop policy if exists included_items_select_same_org on included_items;
create policy included_items_select_same_org on included_items for select to authenticated
  using (organization_id = private.current_staff_org_id());
drop policy if exists included_item_grants_select_same_org on included_item_grants;
create policy included_item_grants_select_same_org on included_item_grants for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- Seed every studio that has class categories and no items yet:
--   Gym access, Group classes, Towels, Recovery, plus one item per category
--   that memberships don't include today (Group Reformer, Personal Training,
--   Private Pilates...). Memberships include Gym access + Group classes.
--   Categories included in membership need Group classes; the others need
--   their own item. Same results as the old switches.
do $$
declare
  org record;
  dept record;
  group_classes uuid;
  gym uuid;
  own uuid;
begin
  for org in
    select o.id from organizations o
    where exists (select 1 from departments d where d.organization_id = o.id)
      and not exists (select 1 from included_items i where i.organization_id = o.id)
  loop
    insert into included_items (organization_id, name, sort) values (org.id, 'Gym access', 1) returning id into gym;
    insert into included_items (organization_id, name, sort) values (org.id, 'Group classes', 2) returning id into group_classes;
    insert into included_items (organization_id, name, sort) values (org.id, 'Towels', 8), (org.id, 'Recovery', 9);
    update organizations set membership_default_items = array[gym, group_classes] where id = org.id;
    for dept in
      select d.id, d.name, coalesce((d.edits ->> 'included_in_membership')::boolean, true) as included
      from departments d where d.organization_id = org.id
    loop
      if dept.included then
        update departments set required_item_id = group_classes where id = dept.id;
      else
        insert into included_items (organization_id, name, sort)
        values (org.id, left(dept.name, 60), 5)
        on conflict (organization_id, lower(name)) do update set name = excluded.name
        returning id into own;
        update departments set required_item_id = own where id = dept.id;
      end if;
    end loop;
  end loop;
end $$;
