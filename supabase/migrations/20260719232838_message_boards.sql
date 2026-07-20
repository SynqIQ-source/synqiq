-- Message Boards: announcements, per-department group chats, and
-- per-substitution-request chats. Design rationale (see conversation this
-- was built from for the full research writeup):
--
-- - Realtime here uses postgres_changes, not Broadcast. Broadcast/Presence
--   authorization is cached for the duration of a client's connection;
--   postgres_changes re-authorizes every event against each subscriber's
--   *current* RLS visibility. Since department eligibility can change
--   mid-session and access must be revoked live (not just on reconnect),
--   postgres_changes is the only one of the two that actually satisfies
--   that requirement.
--
-- - board_members is soft-delete only (removed_at, never a real DELETE).
--   This is not stylistic: Realtime's postgres_changes explicitly does NOT
--   apply RLS to DELETE events (Postgres has no way to check access to a
--   row that no longer exists), confirmed both in Supabase's own docs and
--   in supabase/realtime#562. A hard delete of a board_members row would
--   broadcast to anyone with an open subscription regardless of whether
--   they should see it. Converting removal into an UPDATE keeps it inside
--   RLS's actual coverage. A trigger below enforces this at the schema
--   level so a future stray .delete() call can't silently reintroduce the
--   gap.
--
-- - Group-department board membership is synced by a trigger on
--   instructor_class_eligibility (not application code), so every path
--   that touches eligibility stays in sync, not just today's UI.
--
-- - Group-department boards are only auto-created for departments that
--   have at least one real class_occurrence (mindbody_occurrence_id not
--   null) -- a portable, non-name-based signal for "this is an actual
--   class-teaching department," not an administrative one. This correctly
--   excludes Sports Specific Training/Membership/MBU Courses/WP in this
--   sandbox (zero occurrences, ever) but does NOT exclude Fitness
--   Assessments, which has real occurrences here despite being named as an
--   example of what should be excluded -- this sandbox's data doesn't
--   distinguish it from a genuine group class (capacity pattern is
--   indistinguishable from Yoga/Boot Camp here). `active` exists on
--   message_boards specifically so a board like that can be switched off
--   later with a plain UPDATE, no migration required.
--
-- - message_boards' own SELECT policy checks its row's own columns
--   (organization_id, board_type) plus board_members directly, rather than
--   going through the can_access_board() helper used everywhere else.
--   can_access_board() works by re-querying message_boards for the given
--   board_id -- fine when called from board_messages/board_members (a
--   different table), but self-referential and unsafe if used as
--   message_boards' own policy: INSERT ... RETURNING (what Supabase JS's
--   .insert().select() generates) re-checks the SELECT policy against the
--   new row, and a nested query back into the same table for a row still
--   mid-INSERT in that same command isn't reliably visible yet (an MVCC
--   visibility issue, not a permissions one -- SECURITY DEFINER doesn't
--   fix it). Confirmed empirically while building the select/route.ts hook:
--   an otherwise-identical insert succeeds with no RETURNING and fails
--   with one, for the same admin session and row values.

begin;

create table message_boards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  board_type text not null check (board_type in ('announcements', 'group_department', 'sub_specific')),
  title text not null,
  department_id uuid null references departments (id),
  substitution_request_id uuid null references substitution_requests (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- NULLs don't conflict under a plain UNIQUE constraint in Postgres, so
  -- these correctly only constrain the board_type that actually sets them
  -- (group_department / sub_specific respectively) without needing a
  -- partial index.
  unique (department_id),
  unique (substitution_request_id)
);

-- organization_id IS set on every row regardless of board_type, so "one
-- announcements board per org" genuinely needs a partial index -- a plain
-- UNIQUE(organization_id) would wrongly cap every org at one board total.
create unique index message_boards_one_announcements_per_org
  on message_boards (organization_id)
  where board_type = 'announcements';

create table board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references message_boards (id),
  staff_id uuid not null references staff (id),
  added_at timestamptz not null default now(),
  removed_at timestamptz null,
  unique (board_id, staff_id)
);

create table board_messages (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references message_boards (id),
  author_staff_id uuid not null references staff (id),
  body text not null,
  created_at timestamptz not null default now()
);

-- Enforces the soft-delete-only invariant from the header comment at the
-- schema level, not just by convention -- fires for every role, including
-- the service-role admin client, since triggers (unlike RLS) aren't
-- bypassed by service_role.
create or replace function private.prevent_board_members_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'board_members rows must be soft-deleted via removed_at, not DELETEd -- hard deletes bypass Realtime''s RLS filtering on DELETE events';
end;
$$;

create trigger prevent_board_members_hard_delete_trigger
  before delete on board_members
  for each row
  execute function private.prevent_board_members_hard_delete();

-- === access-control helper ====================================================
-- SECURITY DEFINER so it can read message_boards/board_members regardless of
-- the caller's own RLS visibility into those tables -- same rationale as the
-- existing private.current_staff_* helpers. Safe to use from board_messages/
-- board_members policies (a different table than the one being queried
-- here); NOT used for message_boards' own SELECT policy -- see header
-- comment.
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
        or exists (
          select 1 from board_members bm
          where bm.board_id = mb.id
            and bm.staff_id = private.current_staff_id()
            and bm.removed_at is null
        )
      )
  );
$$;

revoke all on function private.can_access_board(uuid) from public, anon;
grant execute on function private.can_access_board(uuid) to authenticated;

-- === RLS =======================================================================

alter table message_boards enable row level security;
alter table board_members enable row level security;
alter table board_messages enable row level security;

-- Checks its own row's columns + board_members directly rather than
-- can_access_board() -- see header comment for why that matters here
-- specifically.
create policy "message_boards_select_can_access"
  on message_boards for select
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (
      board_type = 'announcements'
      or private.current_staff_role() = 'admin'
      or exists (
        select 1 from board_members bm
        where bm.board_id = message_boards.id
          and bm.staff_id = private.current_staff_id()
          and bm.removed_at is null
      )
    )
  );

-- Admin-only: the only authenticated-role writer is select/route.ts creating
-- a sub_specific board on approval (that route never falls back to the
-- admin client). Every other creation path (announcements/group_department
-- backfill and triggers below) runs with elevated privileges already and
-- doesn't need this policy to succeed.
create policy "message_boards_insert_admin"
  on message_boards for insert
  to authenticated
  with check (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

create policy "board_members_select_can_access"
  on board_members for select
  to authenticated
  using (private.can_access_board(board_id));

-- Admin-only, same rationale as message_boards_insert_admin: this is for
-- select/route.ts inserting the requester + covering instructor on
-- approval. The group_department sync trigger is SECURITY DEFINER and
-- doesn't need this policy.
create policy "board_members_insert_admin"
  on board_members for insert
  to authenticated
  with check (
    private.current_staff_role() = 'admin'
    and exists (
      select 1 from message_boards mb
      where mb.id = board_id and mb.organization_id = private.current_staff_org_id()
    )
  );

create policy "board_messages_select_can_access"
  on board_messages for select
  to authenticated
  using (private.can_access_board(board_id));

create policy "board_messages_insert_can_access"
  on board_messages for insert
  to authenticated
  with check (
    author_staff_id = private.current_staff_id()
    and private.can_access_board(board_id)
    and (
      private.current_staff_role() = 'admin'
      or not exists (
        select 1 from message_boards mb
        where mb.id = board_id and mb.board_type = 'announcements'
      )
    )
  );

-- === group-department membership sync =========================================
-- SECURITY DEFINER so this works regardless of which client the eligibility
-- toggle route is using (admin client today; may migrate later, same as
-- every other route in this app's ongoing RLS rollout).
create or replace function private.sync_department_board_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_board_id uuid;
begin
  if (tg_op = 'DELETE') then
    select id into target_board_id from message_boards
      where department_id = old.department_id and board_type = 'group_department';

    if target_board_id is not null then
      update board_members set removed_at = now()
        where board_id = target_board_id and staff_id = old.staff_id and removed_at is null;
    end if;

    return old;
  end if;

  -- Assumes staff_id/department_id don't change on UPDATE -- the app only
  -- ever toggles `enabled` on an existing (staff, department, class_name)
  -- row, never reassigns the row to a different staff member or department.
  select id into target_board_id from message_boards
    where department_id = new.department_id and board_type = 'group_department';

  if target_board_id is null then
    -- No board for this department -- e.g. it has zero real
    -- class_occurrences and was therefore never auto-created. Nothing to
    -- sync.
    return new;
  end if;

  if new.enabled then
    insert into board_members (board_id, staff_id)
      values (target_board_id, new.staff_id)
      on conflict (board_id, staff_id) do update set removed_at = null;
  else
    update board_members set removed_at = now()
      where board_id = target_board_id and staff_id = new.staff_id and removed_at is null;
  end if;

  return new;
end;
$$;

create trigger sync_department_board_membership_trigger
  after insert or update or delete on instructor_class_eligibility
  for each row
  execute function private.sync_department_board_membership();

-- === auto-create a group-department board on a department's first real class =
-- Deliberately triggered off class_occurrences, not departments: a
-- department has no occurrences yet at the moment it's first synced, so
-- gating on departments' own INSERT would never fire for a genuinely new
-- class-teaching department going forward.
create or replace function private.create_department_board_on_first_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into message_boards (organization_id, board_type, title, department_id)
  select
    coalesce(new.organization_id, (select id from organizations limit 1)),
    'group_department',
    d.name,
    new.department_id
  from departments d
  where d.id = new.department_id
  on conflict (department_id) do nothing;

  return new;
end;
$$;

create trigger create_department_board_on_first_occurrence_trigger
  after insert or update on class_occurrences
  for each row
  when (new.department_id is not null and new.mindbody_occurrence_id is not null)
  execute function private.create_department_board_on_first_occurrence();

-- === backfill ==================================================================

insert into message_boards (organization_id, board_type, title)
select id, 'announcements', 'Announcements' from organizations
on conflict (organization_id) where board_type = 'announcements' do nothing;

insert into message_boards (organization_id, board_type, title, department_id)
select (select id from organizations limit 1), 'group_department', d.name, d.id
from departments d
where exists (
  select 1 from class_occurrences co
  where co.department_id = d.id and co.mindbody_occurrence_id is not null
)
on conflict (department_id) do nothing;

insert into board_members (board_id, staff_id)
select mb.id, ice.staff_id
from instructor_class_eligibility ice
join message_boards mb on mb.department_id = ice.department_id and mb.board_type = 'group_department'
where ice.enabled
on conflict (board_id, staff_id) do nothing;

-- === realtime ===================================================================

alter publication supabase_realtime add table message_boards;
alter publication supabase_realtime add table board_members;
alter publication supabase_realtime add table board_messages;

commit;
