-- New studios get their Sales and Trainers boards automatically, like the
-- Announcements board.

create or replace function private.create_team_boards_for_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into message_boards (organization_id, board_type, title) values (new.id, 'team_sales', 'Sales Team') on conflict do nothing;
  insert into message_boards (organization_id, board_type, title) values (new.id, 'team_trainers', 'Trainers') on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_create_team_boards on organizations;
create trigger organizations_create_team_boards
  after insert on organizations
  for each row execute function private.create_team_boards_for_org();
