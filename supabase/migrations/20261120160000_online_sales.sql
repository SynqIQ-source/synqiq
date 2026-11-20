-- Buy online / in the member app (Adam, 2026-11-19): Club Admins choose
-- which memberships, packs and services are sold online; members (or new
-- buyers matched to an existing guest/lead) pay with Stripe's Payment
-- Element on the studio's account. No staff member is behind these sales.
alter table pos_items add column if not exists sell_online boolean not null default false;

alter table pos_sales drop constraint if exists pos_sales_source_check;
alter table pos_sales add constraint pos_sales_source_check check (source in ('pos', 'renewal', 'online'));

alter table pos_card_payments alter column staff_id drop not null;
alter table pos_card_payments add column if not exists source text not null default 'pos';
alter table pos_card_payments drop constraint if exists pos_card_payments_source_check;
alter table pos_card_payments add constraint pos_card_payments_source_check check (source in ('pos', 'online'));
alter table pos_card_payments drop constraint if exists pos_card_payments_staff_check;
alter table pos_card_payments add constraint pos_card_payments_staff_check check (source = 'online' or staff_id is not null);
