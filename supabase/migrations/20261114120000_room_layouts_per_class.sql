-- Several layouts per room: the room's default, plus layouts used only by
-- certain class types (e.g. Beat in the Cycle room uses mats, not bikes).
-- Existing layouts become their room's default.

alter table room_layouts drop constraint if exists room_layouts_room_id_key;
alter table room_layouts add column if not exists name text not null default 'Main layout';
alter table room_layouts add column if not exists is_default boolean not null default true;
alter table room_layouts add column if not exists class_type_ids uuid[] not null default '{}';

-- One default per room.
create unique index if not exists room_layouts_one_default_idx on room_layouts (room_id) where is_default;
create index if not exists room_layouts_room_idx on room_layouts (room_id);
