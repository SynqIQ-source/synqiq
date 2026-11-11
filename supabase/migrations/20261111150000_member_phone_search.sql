-- Phone search at check-in: digits-only phone numbers (SynqIQ edits win
-- over Mindbody's copy), so "713-555-0199", "(713) 555 0199" and
-- "7135550199" all match.
alter table member_personal add column if not exists phone_digits text generated always as (
  regexp_replace(coalesce(case when edits ? 'mobilePhone' then edits ->> 'mobilePhone' else mindbody ->> 'mobilePhone' end, ''), '\D', '', 'g')
  || '|' ||
  regexp_replace(coalesce(case when edits ? 'homePhone' then edits ->> 'homePhone' else mindbody ->> 'homePhone' end, ''), '\D', '', 'g')
) stored;
create index if not exists member_personal_phone_idx on member_personal (organization_id, phone_digits);
