-- Team message boards: a Sales board (Club Admins, Sales Leads, Sales and
-- anyone who sells) and a Trainers board (Club Admins and trainers), one
-- each per studio. Access comes from the person's role, like Announcements,
-- so there are no board_members rows to keep in sync. Club Admins can now
-- delete any single post (soft delete, kept for the record).

alter table message_boards drop constraint if exists message_boards_board_type_check;
alter table message_boards add constraint message_boards_board_type_check
  check (board_type in ('announcements', 'group_department', 'sub_specific', 'team_sales', 'team_trainers'));
create unique index if not exists message_boards_one_team_board_idx
  on message_boards (organization_id, board_type) where board_type in ('team_sales', 'team_trainers');

create or replace function private.current_staff_on_sales_team()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'sales_lead', 'sales') or can_sell from staff where auth_user_id = auth.uid() and archived_at is null), false);
$$;
create or replace function private.current_staff_is_trainer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' or is_trainer from staff where auth_user_id = auth.uid() and archived_at is null), false);
$$;
revoke all on function private.current_staff_on_sales_team() from public, anon;
revoke all on function private.current_staff_is_trainer() from public, anon;
grant execute on function private.current_staff_on_sales_team() to authenticated;
grant execute on function private.current_staff_is_trainer() to authenticated;

create or replace function private.can_access_board(target_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from message_boards mb
    where mb.id = target_board_id
      and mb.organization_id = private.current_staff_org_id()
      and (
        mb.board_type = 'announcements'
        or private.current_staff_role() = 'admin'
        or (mb.board_type = 'team_sales' and private.current_staff_on_sales_team())
        or (mb.board_type = 'team_trainers' and private.current_staff_is_trainer())
        or exists (
          select 1 from board_members bm
          where bm.board_id = mb.id
            and bm.staff_id = private.current_staff_id()
            and bm.removed_at is null
        )
      )
  );
$$;

drop policy if exists "message_boards_select_can_access" on message_boards;
create policy "message_boards_select_can_access"
  on message_boards for select
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (
      board_type = 'announcements'
      or private.current_staff_role() = 'admin'
      or (board_type = 'team_sales' and private.current_staff_on_sales_team())
      or (board_type = 'team_trainers' and private.current_staff_is_trainer())
      or exists (
        select 1 from board_members bm
        where bm.board_id = message_boards.id
          and bm.staff_id = private.current_staff_id()
          and bm.removed_at is null
      )
    )
  );

-- One Sales and one Trainers board per studio.
insert into message_boards (organization_id, board_type, title)
select o.id, 'team_sales', 'Sales Team' from organizations o
on conflict do nothing;
insert into message_boards (organization_id, board_type, title)
select o.id, 'team_trainers', 'Trainers' from organizations o
on conflict do nothing;

-- Deleting a post (Club Admin): hidden from everyone, kept for the record.
alter table board_messages add column if not exists deleted_at timestamptz;
alter table board_messages add column if not exists deleted_by_staff_id uuid references staff (id);
