-- A Club Admin can change a member's upcoming dues straight from Upcoming
-- charges: set the dues (before tax) on one charge, or on every charge from
-- a date on. Same audit record as other billing edits. $0 is allowed (waive
-- one month). Until the switch it only changes what SynqIQ would charge.

alter table billing_adjustments drop constraint if exists billing_adjustments_amount_cents_check;
alter table billing_adjustments add constraint billing_adjustments_amount_cents_check check (amount_cents is null or amount_cents >= 0);

alter table billing_adjustments drop constraint if exists billing_adjustments_kind_check;
alter table billing_adjustments add constraint billing_adjustments_kind_check
  check (kind in ('credit', 'discount_once', 'discount_ongoing', 'freeze', 'cancel', 'set_amount'));

alter table billing_adjustments drop constraint if exists billing_adjustments_shape_check;
alter table billing_adjustments add constraint billing_adjustments_shape_check check (
  (kind = 'credit' and amount_cents > 0 and percent is null and reason_category is null)
  or (kind in ('discount_once', 'discount_ongoing') and ((amount_cents is null) <> (percent is null)) and coalesce(amount_cents, 1) > 0 and reason_category is null)
  or (kind = 'freeze' and amount_cents is null and percent is null and ends_on is not null and reason_category is null)
  or (kind = 'cancel' and amount_cents is null and percent is null and ends_on is null and reason_category is not null)
  or (kind = 'set_amount' and amount_cents is not null and percent is null and member_contract_id is not null and reason_category is null)
);
