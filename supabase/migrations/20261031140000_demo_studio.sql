-- Demo Studio (lib/demo/generate.ts): a studio filled with made-up people
-- for sales demos and videos. It has no Mindbody site, so the syncs never
-- touch it, and it's topped up nightly (/api/demo/refresh) by adding the new
-- day's activity -- nothing is ever deleted, so the CRM tables' no-delete
-- and no-edit protections stay exactly as they are.

begin;

alter table organizations
  add column is_demo boolean not null default false,
  -- Last day whose demo activity has been generated (studio-local date).
  add column demo_generated_through date;

commit;
