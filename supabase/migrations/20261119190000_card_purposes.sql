-- Two cards per member (Adam, 2026-11-19): one for monthly dues and an
-- optional separate one for retail and drinks. Renewals use the dues card;
-- the POS "Charge card on file" uses the retail card (or, if the member has
-- none, the dues card once staff confirm).
alter table member_cards add column if not exists purpose text not null default 'dues';
alter table member_cards drop constraint if exists member_cards_purpose_check;
alter table member_cards add constraint member_cards_purpose_check check (purpose in ('dues', 'retail'));
alter table member_cards drop constraint if exists member_cards_pkey;
alter table member_cards add primary key (organization_id, mindbody_client_id, livemode, purpose);

-- Which card an emailed link updates (declined / expiring links: dues).
alter table card_update_links add column if not exists purpose text not null default 'dues';
alter table card_update_links drop constraint if exists card_update_links_purpose_check;
alter table card_update_links add constraint card_update_links_purpose_check check (purpose in ('dues', 'retail', 'either'));

-- POS charges to a saved card (no card present): which saved card was used.
alter table pos_card_payments add column if not exists on_file_purpose text check (on_file_purpose is null or on_file_purpose in ('dues', 'retail'));
