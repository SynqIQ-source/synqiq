-- Editing the class catalog in SynqIQ (C2). Changes are stored in each
-- row's `edits` (they win over Mindbody's copy and survive the nightly
-- import) and logged here. Club Admins only; the API writes with the
-- service role after checking the role.
create table if not exists catalog_edits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  entity text not null check (entity in ('class_type', 'class_schedule', 'room', 'program', 'session_type')),
  row_id uuid not null,
  changes jsonb not null, -- {field: {from, to}}; a reset to Mindbody's value has to = "(Mindbody)"
  edited_by_staff_id uuid references staff (id), -- null = set up by SynqIQ from Adam's instructions
  note text,
  created_at timestamptz not null default now()
);
create index if not exists catalog_edits_row_idx on catalog_edits (organization_id, entity, row_id, created_at desc);

alter table catalog_edits enable row level security;
create policy "catalog_edits_select_club_admin" on catalog_edits for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

-- The Preserve: memberships cover every class and appointment program except
-- Personal Training, Private Pilates and Group Reformer (Adam, 2026-11-11).
-- Pool lanes: $20 late-cancel and $20 no-show fee (Mindbody setup, audit B3).
do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  program record;
begin
  if preserve is null then
    return;
  end if;
  for program in
    select id, name, schedule_type from departments
    where organization_id = preserve and schedule_type in ('Class', 'Appointment') and not (edits ? 'included_in_membership')
  loop
    update departments
      set edits = edits || jsonb_build_object('included_in_membership', program.name not in ('Personal Training', 'Private Pilates', 'Group Reformer'))
      where id = program.id;
    insert into catalog_edits (organization_id, entity, row_id, changes, note)
    values (
      preserve, 'program', program.id,
      jsonb_build_object('included_in_membership', jsonb_build_object('from', null, 'to', program.name not in ('Personal Training', 'Private Pilates', 'Group Reformer'))),
      'Membership covers everything except PT, Private Pilates and Group Reformer'
    );
  end loop;

  update departments
    set edits = edits || '{"late_cancel_fee_cents": 2000, "no_show_fee_cents": 2000}'::jsonb
    where organization_id = preserve and name = 'Pool Lanes' and not (edits ? 'late_cancel_fee_cents');
  insert into catalog_edits (organization_id, entity, row_id, changes, note)
  select preserve, 'program', id,
    '{"late_cancel_fee_cents": {"from": null, "to": 2000}, "no_show_fee_cents": {"from": null, "to": 2000}}'::jsonb,
    'Pool lane fees as set in Mindbody'
  from departments where organization_id = preserve and name = 'Pool Lanes';
end $$;
