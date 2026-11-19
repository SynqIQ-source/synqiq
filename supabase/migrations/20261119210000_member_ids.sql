-- New member IDs (Adam, 2026-11-19). Until SynqIQ billing and sales go live
-- (member_id_source = 'mindbody'), a guest or lead who buys a membership is
-- added to Mindbody first and Mindbody hands out the next number. After go-
-- live (member_id_source = 'synqiq'), SynqIQ hands out the next number itself
-- from this counter, continuing Mindbody's sequence (100000001...): atomic,
-- skipping any number already used by a client. NOT switched on: while
-- Mindbody still creates clients (website sign-ups), SynqIQ must not
-- self-assign numbers in the same range.

alter table organizations add column if not exists member_id_source text not null default 'mindbody';
alter table organizations drop constraint if exists organizations_member_id_source_check;
alter table organizations add constraint organizations_member_id_source_check check (member_id_source in ('mindbody', 'synqiq'));

create table if not exists member_id_counters (
  organization_id uuid primary key references organizations (id) on delete cascade,
  next_value bigint not null,
  updated_at timestamptz not null default now()
);
alter table member_id_counters enable row level security; -- server only (no policies)

-- Next free member ID for a studio. The counter row is locked for the
-- transaction, so two sales at once can't get the same number; a number any
-- client already has (as their Mindbody id or unique id) is skipped.
create or replace function private.allocate_member_id(org uuid) returns bigint
  language plpgsql security definer set search_path = public as $$
declare
  candidate bigint;
  floor_value bigint;
begin
  select greatest(coalesce(max(mindbody_unique_id), 0) + 1, 100000001) into floor_value
    from clients where organization_id = org and mindbody_unique_id < 1000000000;
  insert into member_id_counters (organization_id, next_value) values (org, floor_value)
    on conflict (organization_id) do nothing;
  select next_value into candidate from member_id_counters where organization_id = org for update;
  candidate := greatest(candidate, floor_value);
  loop
    exit when not exists (
      select 1 from clients
      where organization_id = org and (mindbody_unique_id = candidate or mindbody_client_id = candidate::text)
    );
    candidate := candidate + 1;
  end loop;
  update member_id_counters set next_value = candidate + 1, updated_at = now() where organization_id = org;
  return candidate;
end $$;
revoke all on function private.allocate_member_id(uuid) from public, anon, authenticated;
grant execute on function private.allocate_member_id(uuid) to service_role;

-- Called through PostgREST by the server (service role) only.
create or replace function public.allocate_member_id(org uuid) returns bigint
  language sql security definer set search_path = public as $$ select private.allocate_member_id(org) $$;
revoke all on function public.allocate_member_id(uuid) from public, anon, authenticated;
grant execute on function public.allocate_member_id(uuid) to service_role;
