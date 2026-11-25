-- Confirm-payment links (2026-11-25). A renewal the member's bank wants
-- them to approve (3D Secure, "authentication_required") can't be charged
-- off-session; the member gets a one-time link to approve that same payment
-- on a SynqIQ page. Reuses card_update_links (token hash, 7 days, used once)
-- with reason 'confirm' and the charge it's for. Additive only.

alter table public.card_update_links
  add column if not exists charge_id uuid references public.membership_charges(id) on delete cascade;

alter table public.card_update_links drop constraint if exists card_update_links_reason_check;
alter table public.card_update_links
  add constraint card_update_links_reason_check
  check (reason = any (array['staff'::text, 'declined'::text, 'expiring'::text, 'confirm'::text]));
