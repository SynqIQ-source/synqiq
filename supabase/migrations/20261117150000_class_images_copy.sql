-- Class photos live in SynqIQ's own storage (class-images bucket), so they
-- keep loading after Mindbody is gone. Mindbody's photo URL is kept apart in
-- mindbody_image_url (the nightly catalog sync writes only that); SynqIQ
-- copies it into class-images and points image_url at the copy. A photo
-- uploaded or removed in SynqIQ (image_source = 'synqiq') is never replaced
-- by the sync.

alter table class_types add column if not exists mindbody_image_url text;
alter table class_types add column if not exists image_source text check (image_source in ('mindbody', 'synqiq'));
alter table class_types add column if not exists image_copied_from text;

-- Today's image_url values that point at Mindbody move to mindbody_image_url;
-- the copy step fills image_url with SynqIQ's copy.
update class_types
set mindbody_image_url = image_url, image_url = null
where image_url like 'https://%mindbodyonline.com/%' and mindbody_image_url is null;

-- Photos already uploaded in SynqIQ stay SynqIQ's.
update class_types set image_source = 'synqiq' where image_url like '%/class-images/%' and image_source is null;
