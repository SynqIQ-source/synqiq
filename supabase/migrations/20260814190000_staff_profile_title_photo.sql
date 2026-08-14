-- Account profile, step 1: staff.title (free-text job title, distinct from
-- the admin/instructor role) and staff.photo_url, plus a storage bucket for
-- self-uploaded avatars.
--
-- No new staff UPDATE RLS policy here on purpose -- a policy scoped to "your
-- own row" would still let a client PATCH straight to `role` (RLS has no
-- column-level granularity without a trigger), which is exactly the
-- self-promotion hole the admin-only role route was built to close. Profile
-- self-edits (display_name, title) go through /api/staff/me/profile instead,
-- an admin-client route that explicitly whitelists which columns a caller
-- can touch on their own row -- same defense-in-depth pattern as
-- /api/staff/[id]/role and /api/staff/[id]/invite.

begin;

alter table staff
  add column if not exists title text,
  add column if not exists photo_url text;

-- === staff-avatars storage bucket ==============================================
-- Public read (an instructor's headshot isn't sensitive); write restricted
-- to the staff member's own object via a path convention of {staff_id}/avatar
-- -- mirrors org-logos' {organization_id}/logo convention exactly, just
-- keyed on the uploader's own staff id instead of admin+org.
insert into storage.buckets (id, name, public)
values ('staff-avatars', 'staff-avatars', true)
on conflict (id) do nothing;

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

commit;
