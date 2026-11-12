-- A photo per class type (Class Catalog), shown on the member booking app
-- and the public website widget. SynqIQ only. class-images is a public
-- bucket: these pictures are for the public schedule.

alter table class_types add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('class-images', 'class-images', true)
on conflict (id) do nothing;

drop policy if exists "class_images_select_public" on storage.objects;
create policy "class_images_select_public" on storage.objects for select to public
  using (bucket_id = 'class-images');
