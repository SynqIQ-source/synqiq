-- Checkout shelves (20261112120000) removed at Adam's request: the
-- organizing he wanted is on Products & Inventory, not the checkout.
-- Membership packages (package_parts, member_billing_schedules) stay.
alter table pos_items drop column if exists group_id;
drop table if exists pos_groups;
