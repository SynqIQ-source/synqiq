-- Products & Inventory:
-- open_price: the amount is entered at checkout (e.g. the 12-month
--   termination fee = half the dues left on the contract).
-- deleted_at: a Club Admin deleted the item. It disappears from inventory
--   and checkout, stays out on the next Mindbody pull, and past sales keep
--   pointing at it.
alter table pos_items add column if not exists open_price boolean not null default false;
alter table pos_items add column if not exists deleted_at timestamptz;
