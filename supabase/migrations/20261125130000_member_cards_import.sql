-- Cards migrated from Mindbody by Stripe (2026-11-25): saved as members'
-- dues cards with updated_via 'import' (lib/billing/card-import-save.ts),
-- so it's clear which cards came from the migration. Additive only.

alter table public.member_cards drop constraint if exists member_cards_updated_via_check;
alter table public.member_cards
  add constraint member_cards_updated_via_check
  check (updated_via = any (array['desk'::text, 'link'::text, 'app'::text, 'pos'::text, 'import'::text]));
