-- secondary_color: the 20260721180000 migration deliberately left this out
-- ("no secondary color exists in the UI... add it later once there's an
-- actual design need"). Two real uses now: the desktop sidebar's active-link
-- indicator (nothing highlights the current page there today -- the mobile
-- bottom nav already does this with primary_color, so the desktop sidebar
-- gets its own distinct color rather than reusing primary) and
-- secondary-emphasis trigger buttons that sit alongside a true bg-primary
-- CTA in the same flow (Request New Sub / View Candidates).
--
-- Defaults to the same #0f766e as primary/accent, for the same reason those
-- two did: applying this migration is a no-op until an admin actually
-- customizes their org, since the two new UI uses render identically to
-- text-primary/no-highlight-at-all when secondary_color == primary_color.
begin;

alter table organizations
  add column secondary_color text not null default '#0f766e'
    check (secondary_color ~ '^#[0-9a-fA-F]{6}$');

commit;
