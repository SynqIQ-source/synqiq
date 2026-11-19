-- Member booking opens to every member (Adam, 2026-11-18): the parallel-run
-- tester list is retired. Modes are now 'off' (hidden) or 'open'; new
-- studios start 'off'. Studios in tester mode switch to 'open'.
--
-- Class rating emails in tester mode emailed only those testers; with the
-- list gone they switch to 'off' (a Club Admin can choose "Every member").

update organizations set member_portal_mode = 'open' where member_portal_mode = 'testers';
alter table organizations drop constraint if exists organizations_member_portal_mode_check;
alter table organizations alter column member_portal_mode set default 'off';
alter table organizations add constraint organizations_member_portal_mode_check check (member_portal_mode in ('off', 'open'));

update organizations set ratings_mode = 'off' where ratings_mode = 'testers';
alter table organizations drop constraint if exists organizations_ratings_mode_check;
alter table organizations alter column ratings_mode set default 'off';
alter table organizations add constraint organizations_ratings_mode_check check (ratings_mode in ('off', 'everyone'));

drop table if exists member_portal_testers;
