-- Stripe webhook events already processed (app/api/stripe/webhook). Stripe
-- delivers at least once and retries, so each event id is recorded before it
-- is handled and a repeat is skipped. Service-role only: RLS on, no policies.
create table if not exists stripe_events (
  id text primary key,                 -- Stripe event id (evt_...)
  type text not null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
