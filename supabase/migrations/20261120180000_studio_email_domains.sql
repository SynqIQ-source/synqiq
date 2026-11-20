-- Studio email domains (Adam, 2026-11-19): member-facing email can come from
-- the studio's own domain instead of synqiq.co once it's verified in Resend.
--   email_from_domain: sends notifications@<domain> (e.g. thepreservehouston.com)
--   email_relay_domain: the private reply addresses of the follow-up and guest
--     email relays (needs receiving, so a subdomain such as
--     reply.thepreservehouston.com that doesn't touch the studio's own mailboxes)
-- Each is used only after SynqIQ has seen it verified in Resend.
alter table organizations add column if not exists email_from_domain text;
alter table organizations add column if not exists email_from_verified_at timestamptz;
alter table organizations add column if not exists email_relay_domain text;
alter table organizations add column if not exists email_relay_verified_at timestamptz;
alter table organizations drop constraint if exists organizations_email_from_domain_check;
alter table organizations add constraint organizations_email_from_domain_check
  check (email_from_domain is null or email_from_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');
alter table organizations drop constraint if exists organizations_email_relay_domain_check;
alter table organizations add constraint organizations_email_relay_domain_check
  check (email_relay_domain is null or email_relay_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');
create unique index if not exists organizations_email_relay_domain_key on organizations (email_relay_domain) where email_relay_domain is not null;
