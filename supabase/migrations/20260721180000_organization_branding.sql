-- Per-studio branding: primary_color (CTA buttons, links, nav accent) and
-- accent_color (status/confirmation badges) map to the only real color
-- usage this app has today -- see conversation history for the audit (17
-- teal/emerald occurrences across 10 files, cleanly split into those two
-- roles; no secondary color exists in the UI, so secondary_color is
-- deliberately not added here -- add it later once there's an actual
-- design need, not provisioned inert now).
--
-- Colors default to the current hardcoded teal-700 (#0f766e) so applying
-- this migration is a no-op visually until an admin actually customizes
-- their org -- same value on both columns since primary and accent
-- currently render as the identical color in this UI.
--
-- font_family is constrained to a curated allowlist, not free text --
-- design-consistency reasons, not licensing (every Google Font is
-- OFL/Apache licensed regardless of which one is picked; the risk this
-- guards against is arbitrary uploaded fonts, which this feature doesn't
-- allow at all).
--
-- logo_url has no default (null until an admin uploads one) -- the UI
-- falls back to the existing plain-text "Synq" wordmark when null, same
-- fallback-to-current-behavior philosophy as the colors.

begin;

alter table organizations
  add column primary_color text not null default '#0f766e'
    check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column accent_color text not null default '#0f766e'
    check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  add column logo_url text,
  add column font_family text not null default 'Inter'
    check (font_family in (
      'Inter', 'Manrope', 'Work Sans', 'Sora',
      'Lexend', 'Plus Jakarta Sans', 'DM Sans', 'Outfit'
    ));

-- === write access: admin-only, own org, mirrors substitution_requests_update_admin ===
create policy "organizations_update_admin"
  on organizations for update
  to authenticated
  using (
    id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  )
  with check (
    id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

-- === org-logos storage bucket ==================================================
-- Public read (a studio's logo isn't sensitive, and avoids needing signed
-- URLs for something this low-stakes); write restricted to that org's admin
-- via a path convention of {organization_id}/logo -- storage.foldername()
-- splits the object key on "/", so element [1] is the org id segment.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

create policy "org_logos_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'org-logos');

create policy "org_logos_insert_admin_own_org"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and private.current_staff_role() = 'admin'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
  );

create policy "org_logos_update_admin_own_org"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and private.current_staff_role() = 'admin'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
  )
  with check (
    bucket_id = 'org-logos'
    and private.current_staff_role() = 'admin'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
  );

create policy "org_logos_delete_admin_own_org"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-logos'
    and private.current_staff_role() = 'admin'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
  );

commit;
