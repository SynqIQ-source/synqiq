-- ============================================================================
-- Storage buckets and storage rules for the LOCAL test database. Never run
-- this against the hosted project.
--
-- The baseline export (schema.sql) covers only the `public` and `private`
-- schemas, and exporting `storage` would clash with the local stack's own
-- storage tables. So the buckets and policies are rebuilt here from the
-- migrations that created them (latest version of each; none was later
-- dropped or replaced):
--   org-logos          20260721180000_organization_branding
--   report-imports     20260727150000_report_imports_and_instructor_reviews
--   staff-avatars      20260814190000_staff_profile_title_photo
--   crm-private        20261028120000_crm_phase1,
--                      20261030130000_crm_member_onboarding
--   pos-images         20261111220000_pos_catalog
--   class-images       20261112220000_class_type_images
--   member-photos      20261113120000_member_photos
--   maintenance-media  20261116180000_maintenance
-- Copy any new storage bucket or policy here when a migration adds one.
-- ============================================================================

insert into storage.buckets (id, name, public) values
  ('org-logos', 'org-logos', true),
  ('report-imports', 'report-imports', false),
  ('staff-avatars', 'staff-avatars', true),
  ('crm-private', 'crm-private', false),
  ('pos-images', 'pos-images', true),
  ('class-images', 'class-images', true),
  ('member-photos', 'member-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maintenance-media', 'maintenance-media', false, 52428800,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

-- org-logos ------------------------------------------------------------------
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

-- report-imports -------------------------------------------------------------
create policy "report_imports_bucket_admin_own_org"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'report-imports'
    and private.current_staff_role() = 'admin'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
  )
  with check (
    bucket_id = 'report-imports'
    and private.current_staff_role() = 'admin'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
  );

-- staff-avatars --------------------------------------------------------------
create policy "staff_avatars_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'staff-avatars');

create policy "staff_avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'staff-avatars'
    and (storage.foldername(name))[1] = private.current_staff_id()::text
  );

create policy "staff_avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'staff-avatars'
    and (storage.foldername(name))[1] = private.current_staff_id()::text
  )
  with check (
    bucket_id = 'staff-avatars'
    and (storage.foldername(name))[1] = private.current_staff_id()::text
  );

create policy "staff_avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'staff-avatars'
    and (storage.foldername(name))[1] = private.current_staff_id()::text
  );

-- crm-private ----------------------------------------------------------------
create policy "crm_private_read_crm_staff"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'crm-private'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
    and (private.current_staff_role() = 'admin' or private.current_staff_can_sell())
  );

create policy "crm_private_read_assigned_trainer_photo"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'crm-private'
    and exists (
      select 1 from public.crm_contacts c
      where c.photo_path = storage.objects.name and private.is_assigned_trainer(c.id)
    )
  );

-- pos-images / class-images --------------------------------------------------
create policy "pos_images_select_public" on storage.objects for select to public
  using (bucket_id = 'pos-images');

create policy "class_images_select_public" on storage.objects for select to public
  using (bucket_id = 'class-images');
