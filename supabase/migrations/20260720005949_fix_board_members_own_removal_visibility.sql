-- Fixes a real bug found while verifying the board_members UPDATE
-- subscription live: revoking someone's eligibility correctly soft-removes
-- their board_members row (removed_at gets set, confirmed independently
-- against the DB), but the live UI never reacted -- the Realtime event
-- carrying that exact UPDATE never reached the client it was about.
--
-- Cause: board_members_select_can_access requires being a *current* member
-- (removed_at is null, via can_access_board) to see any board_members rows
-- for that board. The one row that needs to reach the person losing
-- access -- the UPDATE that sets removed_at -- fails that same check for
-- them the instant it's set, since Postgres Realtime authorizes each
-- event's NEW row state against the subscriber's current RLS visibility.
-- The person being removed was blocked from seeing their own removal.
--
-- Fix: you can always see your own board_members rows, full stop, whether
-- or not you're currently an active member of that board. Knowing "am I
-- (still) a member of this board" about yourself was never sensitive --
-- this doesn't expose anyone else's rows, staff_id = current_staff_id()
-- only ever matches your own.

begin;

drop policy "board_members_select_can_access" on board_members;

create policy "board_members_select_can_access"
  on board_members for select
  to authenticated
  using (
    private.can_access_board(board_id)
    or staff_id = private.current_staff_id()
  );

commit;
