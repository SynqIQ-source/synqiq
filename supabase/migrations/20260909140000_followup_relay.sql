-- Instructor follow-up email relay ("masked messaging").
--
-- An instructor sends a retention follow-up to a checked-in member from
-- inside SynqIQ. The member sees the mail as coming from
-- "<Instructor first name> at <Studio name>" at a per-conversation masked
-- alias on followup.synqiq.co -- never the instructor's real address and
-- never the SynqIQ brand. Replies from either side land on that same alias
-- and are relayed on to the other party's real inbox, thread intact.
--
-- Design decisions (from the 2026-09-08 planning session):
--   - Relay subdomain is followup.synqiq.co (SynqIQ already controls it),
--     so no SPF/DKIM work is needed on the studio's own domain.
--   - display_name is NOT stored -- it is derived at send time as
--     "<staff.first_name> at <organizations.name>". The conversation row
--     keeps instructor_id + organization_id so an inbound relay can
--     re-derive it.
--   - client_email / instructor_email are snapshotted onto the
--     conversation at creation. Inbound direction detection matches the
--     sender against these two values; snapshotting also means a later
--     edit to clients.email or the instructor's auth email can't silently
--     re-route a live thread.
--   - Writes go through API routes gated by getCurrentStaff() (the current
--     interim auth pattern -- staff RLS is still pending), so these tables
--     get RLS enabled with an org-scoped SELECT policy only, no
--     INSERT/UPDATE policy.
begin;

-- === clients.email ===========================================================
-- Captured from the roster pull that already runs in lib/sync/clients.ts
-- (no new MindBody call). Persisted ONLY for clients who have at least one
-- signed_in class_visit -- i.e. members who actually checked in to a class,
-- the only people an instructor can send a follow-up to. Everyone else's
-- address is read from the same payload and discarded. No backfill job:
-- the column fills in over subsequent syncs as members check in.
alter table clients add column email text;

comment on column clients.email is
  'Member email, synced from MindBody GET /client/clients but persisted only for clients with a signed_in class_visit (see lib/sync/clients.ts). Null for everyone else by design.';

-- === followup_conversations =================================================
-- One row per (instructor, member) pair, reused for every follow-up that
-- instructor sends that member -- the alias and mail thread persist. A new
-- outreach months later updates `subject` and `last_message_at` on the
-- existing row rather than minting a fresh alias.
create table followup_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  instructor_id uuid not null references staff (id),
  client_id uuid not null references clients (id),
  -- The persistent masked address, "<uuid>@followup.synqiq.co". Used as
  -- the From on the leg to the member and as the Reply-To on both legs, so
  -- neither party ever has the other's real address. Full local part is a
  -- v4 uuid (dashes kept -- Resend inbound preserves them).
  alias text not null unique,
  -- Real addresses as they were at conversation creation. See header.
  client_email text not null,
  instructor_email text not null,
  -- Last subject used on an outbound follow-up; inbound replies reuse it
  -- (prefixed "Re:" by the sending side).
  subject text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (organization_id, instructor_id, client_id)
);

alter table followup_conversations enable row level security;

-- SELECT only -- every write is an admin-client insert/update from an API
-- route that has already resolved the caller via getCurrentStaff(). Same
-- interim pattern as staff self-edits and message_boards creation.
create policy "followup_conversations_select_same_org"
  on followup_conversations for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

create index followup_conversations_org_instructor_idx
  on followup_conversations (organization_id, instructor_id);
-- `alias` already has a unique index from its constraint -- that is the
-- inbound-webhook lookup path.

-- === followup_messages =====================================================
create table followup_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references followup_conversations (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  -- 'outbound' = instructor -> member; 'inbound' = member -> instructor.
  direction text not null check (direction in ('outbound', 'inbound')),
  from_email text not null,
  to_email text not null,
  -- The quote-stripped text that was actually relayed on.
  body_text text not null,
  -- Resend's id for a message WE sent (outbound legs and the relayed copy
  -- of an inbound message). Null on the raw received record.
  resend_message_id text,
  -- The RFC Message-ID header carried by a received email. Null for a
  -- message we originated.
  provider_message_id text,
  -- What we set as In-Reply-To when sending this leg (for debugging broken
  -- threading).
  in_reply_to text,
  created_at timestamptz not null default now()
);

alter table followup_messages enable row level security;

create policy "followup_messages_select_same_org"
  on followup_messages for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

create index followup_messages_conversation_idx
  on followup_messages (conversation_id, created_at);

commit;
