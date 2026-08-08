-- revenue_line_items was a schema-only stub (20260727150000) written
-- before the real Attendance-with-Revenue export was verified against
-- live column names/values. This migration applies what that verification
-- found (see conversation history):
--
-- Mindbody's "Rev. per Visit" is only a stable, real per-visit fact for
-- capped/fixed-count packages (PT packs, Pilates packs, single sessions,
-- day passes). For uncapped/unlimited plans (unlimited memberships,
-- unlimited group reformer, etc.) it's actually
-- (monthly fee / visits so far in the member's current billing cycle),
-- recalculated and back-applied to every visit row in that cycle every
-- time the report is pulled -- not a stable per-visit fact, and billing
-- cycles are per-member, not calendar-aligned. Cycle-based rollup for
-- uncapped plans is a separate, harder problem, deliberately out of scope
-- here.
--
-- Detection rule (validated against real export data): the "Visits Rem."
-- column. Under 1000 = a real fixed-count package (capped). Tens/hundreds
-- of thousands = Mindbody's placeholder range for "no real limit"
-- (uncapped). The Pricing Option name string is NOT reliable for this --
-- confirmed inconsistent in real data (e.g. "PT 60 16PK" ranges $90-$110
-- across different real clients, so it's also not usable as a static
-- price lookup -- the per-row Rev. per Visit value is the source of
-- truth, never a derived/looked-up price).
--
-- No join to class_occurrences: the dashboard export carries no Mindbody
-- occurrence id, and matching by (date + staff name + class name text)
-- alone is exactly the fuzzy-join risk this codebase already declined once
-- for instructor_reviews (free-text service_name, no FK). revenue_line_items
-- follows that same precedent -- its own fact table, not attached to
-- class_occurrences.
begin;

-- revenue_amount: NULL now means something different than 0. NULL =
-- excluded from attribution entirely (uncapped plan, Visits Rem. >= 1000
-- -- see CAPPED_VISITS_THRESHOLD in lib/imports/definitions/revenue.ts).
-- 0 = a real, trusted $0 from a CAPPED row (e.g. a comp/promo) -- still
-- imported, but surfaced in the import's warnings_summary for a human to
-- eyeball rather than silently accepted or rejected. This is why the
-- column moves off NOT NULL: the distinction between "no revenue data"
-- and "$0 legitimately" needs to survive into every downstream query
-- (Instructor Analytics, Trainer Health-style views) without a separate
-- flag column.
alter table revenue_line_items
  alter column revenue_amount drop not null;

comment on column revenue_line_items.revenue_amount is
  'NULL = excluded from attribution (uncapped/unlimited plan). 0 = a real, trusted $0 from a capped plan (e.g. comp/promo) -- see warnings_summary on the owning report_imports row for a list to manually review. Never a derived/looked-up value -- always the source row''s own Rev. per Visit figure for capped rows.';

-- service_category was written NOT NULL before the real report's columns
-- were verified (see 20260727150000's own comment acknowledging this).
-- Same uncertainty instructor_reviews already hit with its analogous
-- service_name column, resolved the same way there: optional.
alter table revenue_line_items
  alter column service_category drop not null;

-- The raw "Visits Rem." fact, kept permanently -- not reduced to a
-- derived is_capped boolean. Attribution status is computed at query time
-- from this value (visits_remaining < CAPPED_VISITS_THRESHOLD), the same
-- "always compute at query time, never pre-store a derived flag"
-- convention already used for fill rates elsewhere in this app. Keeping
-- the raw value also means a future change to the threshold needs no
-- backfill -- every existing row can be re-evaluated from what's already
-- stored. NOT NULL with no default is safe here: the table is currently
-- empty (0 rows, no ImportDefinition has ever written to it).
alter table revenue_line_items
  add column visits_remaining integer not null;

comment on column revenue_line_items.visits_remaining is
  'Raw "Visits Rem." value from the source report. Under 1000 = a real fixed-count package (capped) -- trust revenue_amount as a real per-visit fact. Tens/hundreds of thousands = Mindbody''s placeholder for an uncapped/unlimited plan -- revenue_amount is NULL for these rows. See CAPPED_VISITS_THRESHOLD in lib/imports/definitions/revenue.ts.';

-- report_imports: a second, non-failure signal, parallel to the existing
-- error_summary. An import can succeed (rows inserted, status stays
-- 'success') while still carrying caveats worth a human's attention --
-- excluded uncapped rows, or capped rows that legitimately show $0
-- revenue. NULL for report types with no such caveats (ratings_reviews
-- today).
alter table report_imports add column warnings_summary jsonb;

comment on column report_imports.warnings_summary is
  'Non-blocking caveats on an otherwise-successful import (e.g. excluded uncapped row count, zero-revenue capped row count/list for revenue imports). Distinct from error_summary, which is only ever populated on status = ''failed''.';

commit;
