-- Member photos copied from Mindbody into SynqIQ's own storage, so they
-- survive leaving Mindbody. member-photos is a PRIVATE bucket (no public or
-- authenticated read policy): the server hands staff short-lived signed links.

alter table member_personal add column if not exists photo_path text; -- key in member-photos
alter table member_personal add column if not exists photo_source_url text; -- the Mindbody URL it was copied from
alter table member_personal add column if not exists photo_copied_at timestamptz;

insert into storage.buckets (id, name, public)
values ('member-photos', 'member-photos', false)
on conflict (id) do update set public = false;
