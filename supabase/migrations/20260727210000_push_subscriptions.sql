-- ============================================================================
-- Web Push subscriptions: one row per device/browser a staff member has
-- enabled notifications on (endpoint is the browser push service's unique
-- URL for that subscription, so it's the natural per-device key -- a staff
-- member on phone + laptop gets two rows).
--
-- Single "for all" policy scoped to private.current_staff_id(): a
-- subscription is purely a staff member managing their own devices, no
-- admin/cross-staff visibility or write access is meaningful here, unlike
-- most other org-scoped tables in this schema.
-- ============================================================================

begin;

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  staff_id uuid not null references staff (id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "push_subscriptions_own_row"
  on push_subscriptions for all
  to authenticated
  using (staff_id = private.current_staff_id())
  with check (staff_id = private.current_staff_id());

commit;
