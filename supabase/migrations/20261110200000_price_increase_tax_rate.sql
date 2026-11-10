-- Each membership's sales-tax rate when an increase was scheduled. The
-- increase changes the dues before tax; tax is shown separately (never
-- edited) for display and reporting.
alter table price_increase_items add column if not exists tax_rate numeric(8, 6) check (tax_rate is null or (tax_rate >= 0 and tax_rate < 1));
