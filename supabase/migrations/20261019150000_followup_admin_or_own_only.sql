-- Follow-up message history: visible only to the instructor who owns the
-- thread and to admins.
--
-- 20260909140000_followup_relay.sql gave both tables an org-scoped SELECT
-- policy, so any signed-in staff member could read every instructor's
-- follow-ups with members at the database level -- only the app's screens
-- narrowed it to "your own". This makes the database enforce it too.
--
-- Every in-app read already fits: Follow Up and a thread page read the
-- caller's own conversations (or an admin opens any), and Follow-ups
-- (/dashboard/follow-up-activity) is admin-only. All writes go through the
-- service-role client in API routes / lib/followup/relay.ts, which RLS
-- doesn't apply to.

begin;

drop policy if exists "followup_conversations_select_same_org" on followup_conversations;
drop policy if exists "followup_messages_select_same_org" on followup_messages;

create policy "followup_conversations_select_own_or_admin"
  on followup_conversations for select
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (
      instructor_id = private.current_staff_id()
      or private.current_staff_role() = 'admin'
    )
  );

-- A message is visible when its conversation is: the subquery runs under
-- followup_conversations' own policy above, so this inherits the same rule.
create policy "followup_messages_select_own_or_admin"
  on followup_messages for select
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and exists (
      select 1
      from followup_conversations fc
      where fc.id = followup_messages.conversation_id
    )
  );

commit;
