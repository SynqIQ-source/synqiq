-- PT session rules per studio: whether a no-show or a late cancel uses a
-- session from the client's pack (both yes by default; completed always does).
alter table organizations add column if not exists pt_no_show_uses_session boolean not null default true;
alter table organizations add column if not exists pt_late_cancel_uses_session boolean not null default true;
