-- Check-ins record the member's billing standing at the time (red =
-- declined / terminated / frozen; green = covered and in good standing)
-- and whether they scanned their key card.
alter table check_ins add column if not exists billing_standing text not null default 'none'
  check (billing_standing in ('good', 'attention', 'none'));
alter table check_ins add column if not exists standing_reasons jsonb not null default '[]'::jsonb;

alter table check_ins drop constraint if exists check_ins_method_check;
alter table check_ins add constraint check_ins_method_check check (method in ('front_desk', 'scan', 'kiosk'));

create index if not exists check_ins_standing_idx on check_ins (organization_id, local_date, billing_standing);
