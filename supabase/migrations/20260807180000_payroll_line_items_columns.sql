-- payroll_line_items was a schema-only stub (20260727150000) written
-- before the real Payroll export was verified. Verification found two
-- different reports:
--
-- 1. "Payroll" (Reports > Payroll) -- human-readable, grouped by staff and
--    by pay-rate type, with THREE incompatible row shapes depending on pay
--    type (per-class-date, per-appointment-date with client/revenue
--    detail, and a single lump hourly-pay line per staff). Not used here --
--    doesn't fit this codebase's one-flat-table-per-ImportDefinition
--    pattern without heterogeneous per-row-type branching.
-- 2. "Payroll Export Setup" (Reports > Payroll Export Setup) -- built for
--    3rd-party/ADP export, ONE uniform flat table across every pay type.
--    This is what payroll_line_items is built against. Verified against a
--    real 472-row July pull.
--
-- For Personal Training and Hourly pay rows, this export collapses to a
-- single lump row per instructor per pay period (class_date/weekday/
-- start_time/end_time all blank, earnings_amt = the whole period's
-- total). That's expected, not a data gap: payroll_line_items is a pure
-- "what did we actually pay" finance record, not a re-derivation of
-- trainer performance -- per-appointment session/sales detail already
-- lives independently in appointment_occurrences/sales via the live API
-- sync (see the Trainer Health feature). Nothing here joins against those.
begin;

alter table payroll_line_items
  add column staff_id uuid references staff (id),
  add column staff_name_raw text not null,
  -- Doubles as a pay-category label for non-class rows ("Personal
  -- Training", "Hourly Pay") as well as a real class name -- always
  -- populated in every real row observed, unlike the date/time/students
  -- columns below.
  add column class_name text not null,
  -- NULL on all four of these together = a lump-sum row (Personal
  -- Training/Hourly Pay), not missing/bad data -- confirmed against real
  -- export rows for both pay types.
  add column class_date date,
  add column weekday text,
  -- Raw display strings ("5:30 pm"), not parsed into a timestamp -- no
  -- timezone info in the source, and nothing downstream needs to do
  -- arithmetic on them.
  add column start_time text,
  add column end_time text,
  add column earnings_amt numeric not null,
  -- File Number and Program Code were blank in every real row at this
  -- org -- nullable, not assumed blank at every studio.
  add column file_number text,
  add column program_code text;

-- students is a real semantic quirk, not a modeling mistake: for a class
-- row it's a real headcount; for a Personal Training lump row it held
-- something like a period session/appointment count instead (confirmed:
-- one real row showed 49 for a whole month, clearly not literal
-- "students" in a PT context) -- never the same meaning across row types,
-- so don't treat it as a comparable metric between them.
alter table payroll_line_items add column students integer;
comment on column payroll_line_items.students is
  'Real headcount for a class row. For a Personal Training lump row, something like a period session count instead (confirmed empirically: 49 for a whole month, not literal students) -- never comparable across row types. NULL for Hourly Pay rows.';

comment on column payroll_line_items.class_date is
  'NULL (alongside weekday/start_time/end_time) means this is a lump-sum row for a non-class pay type (Personal Training, Hourly Pay) -- earnings_amt is that row''s whole-period total, not a single session''s pay. Expected, not missing data.';

comment on column payroll_line_items.class_name is
  'A real class name for class rows, or a pay-category label ("Personal Training", "Hourly Pay") for lump-sum rows -- always populated.';

create index payroll_line_items_org_staff_date_idx
  on payroll_line_items (organization_id, staff_id, class_date);

commit;
