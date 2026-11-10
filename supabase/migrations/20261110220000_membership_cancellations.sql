-- Membership cancellations as a billing edit: charges stop from starts_on
-- (the first date not billed) on one membership or all of a member's. The
-- reason category is kept for reports (why members leave); `reason` holds
-- the details typed in. Undoing a cancellation is the same cancelled_*
-- audit fields as any edit.
alter table billing_adjustments drop constraint if exists billing_adjustments_kind_check;
alter table billing_adjustments add constraint billing_adjustments_kind_check
  check (kind in ('credit', 'discount_once', 'discount_ongoing', 'freeze', 'cancel'));

alter table billing_adjustments add column if not exists reason_category text
  check (reason_category is null or reason_category in ('moving', 'switching', 'non_use', 'class_quality', 'other'));

alter table billing_adjustments drop constraint if exists billing_adjustments_check1;
alter table billing_adjustments add constraint billing_adjustments_shape_check check (
  (kind = 'credit' and amount_cents is not null and percent is null and reason_category is null)
  or (kind in ('discount_once', 'discount_ongoing') and ((amount_cents is null) <> (percent is null)) and reason_category is null)
  or (kind = 'freeze' and amount_cents is null and percent is null and ends_on is not null and reason_category is null)
  or (kind = 'cancel' and amount_cents is null and percent is null and ends_on is null and reason_category is not null)
);

create index if not exists billing_adjustments_cancel_idx on billing_adjustments (organization_id, kind, reason_category)
  where kind = 'cancel';
