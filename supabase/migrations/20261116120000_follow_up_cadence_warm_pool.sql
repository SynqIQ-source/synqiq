-- Follow-up cadence per studio (null = SynqIQ's default: 7 attempts, the
-- first two a day apart, then every 3 days; warm pool 2 days after the 7th
-- with no reply) and the warm lead pool flag on contacts (set nightly by
-- /api/crm/warm-pool; cleared when they reply, visit, book or are given a
-- follow-up date). The marketing section will read warm_pool_at as an
-- audience.

alter table public.organizations add column if not exists follow_up_cadence jsonb;

alter table public.crm_contacts add column if not exists warm_pool_at timestamptz;

create index if not exists crm_contacts_warm_pool_idx
  on public.crm_contacts (organization_id, warm_pool_at)
  where warm_pool_at is not null;
