-- Modules and plans (lib/plans.ts, lib/modules.ts).
--
-- Group Fitness and Trainer become modules a studio can turn on or off,
-- like the CRM. Until now their features were on for every studio, so every
-- existing studio gets both turned on here and nothing changes for them.
-- A studio's monthly price follows from its modules unless it has a custom
-- price (The Preserve keeps $299 until the CRM launches).

begin;

alter table org_modules drop constraint org_modules_module_check;
alter table org_modules add constraint org_modules_module_check
  check (module in ('crm', 'group_fitness', 'trainer'));

insert into org_modules (organization_id, module)
select id, module
from organizations cross join (values ('group_fitness'), ('trainer')) as m (module)
on conflict (organization_id, module) do nothing;

alter table organizations
  add column custom_monthly_price numeric check (custom_monthly_price >= 0);

update organizations set custom_monthly_price = 299 where mindbody_site_id = 561843;

commit;
