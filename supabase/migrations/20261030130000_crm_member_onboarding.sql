-- New-member onboarding: members who enroll in Mindbody get a profile (the
-- same page guests have), an admin assigns them to a trainer, and the
-- trainer reaches out (texts, emails, logged calls) to book an Intro
-- Workout. Trainers can read ONLY the members assigned to them -- enforced
-- here with RLS, not just in the app.
begin;

-- Mindbody's client "Id" (what appointments reference). Not always the same
-- as UniqueId for older clients, so Intro Workouts are matched on this.
alter table clients add column mindbody_client_id text;
create index clients_org_mindbody_client_id_idx on clients (organization_id, mindbody_client_id);

-- The Mindbody appointment type that counts as an intro workout.
alter table organizations add column crm_intro_session_type_id integer;
update organizations set crm_intro_session_type_id = 44 where mindbody_site_id = 561843;

-- "member": joined in Mindbody without coming through the CRM. These are
-- not leads and stay out of the Sales dashboard and the Guests list.
alter table crm_contacts drop constraint crm_contacts_source_check;
alter table crm_contacts add constraint crm_contacts_source_check
  check (source in ('walk_in', 'guest_of_member', 'phone_in', 'web', 'other', 'member'));

-- Enrollment, from the member's Mindbody contract.
alter table crm_contacts add column member_enrolled_at timestamptz;       -- contract start date
alter table crm_contacts add column membership_name text;
alter table crm_contacts add column membership_sold_by_staff_id uuid references staff (id);
alter table crm_contacts add column enrollment_detected_at timestamptz;   -- when Synq saw them turn Active
alter table crm_contacts add column enrollment_status text
  check (enrollment_status in ('pending', 'found', 'no_contract'));
-- The trainer working this member's intro.
alter table crm_contacts add column trainer_staff_id uuid references staff (id);
alter table crm_contacts add column trainer_assigned_at timestamptz;
alter table crm_contacts add column trainer_assigned_by_staff_id uuid references staff (id);
create index crm_contacts_org_enrolled_idx on crm_contacts (organization_id, member_enrolled_at desc)
  where member_enrolled_at is not null;
create index crm_contacts_trainer_idx on crm_contacts (trainer_staff_id) where trainer_staff_id is not null;
create index crm_contacts_org_mindbody_client_idx on crm_contacts (organization_id, mindbody_client_id);

alter table crm_jobs drop constraint crm_jobs_kind_check;
alter table crm_jobs add constraint crm_jobs_kind_check check (kind in ('email_check', 'mindbody_push', 'member_contract'));

-- True when the signed-in staff member is the trainer assigned to this
-- contact (or to the contact it was merged into). Security definer so the
-- crm_contacts policy can use it without recursing into itself.
create or replace function private.is_assigned_trainer(target_contact uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from crm_contacts c
    left join crm_contacts parent on parent.id = c.merged_into_id
    where c.id = target_contact
      and c.organization_id = private.current_staff_org_id()
      and (c.trainer_staff_id = private.current_staff_id() or parent.trainer_staff_id = private.current_staff_id())
  );
$$;

create policy "crm_contacts_select_assigned_trainer"
  on crm_contacts for select to authenticated
  using (private.is_assigned_trainer(id));
create policy "guest_visits_select_assigned_trainer"
  on guest_visits for select to authenticated
  using (private.is_assigned_trainer(contact_id));
create policy "waiver_signatures_select_assigned_trainer"
  on waiver_signatures for select to authenticated
  using (private.is_assigned_trainer(contact_id));
create policy "crm_notes_select_assigned_trainer"
  on crm_notes for select to authenticated
  using (private.is_assigned_trainer(contact_id));
create policy "crm_messages_select_assigned_trainer"
  on crm_messages for select to authenticated
  using (private.is_assigned_trainer(contact_id));
create policy "crm_appointments_select_assigned_trainer"
  on crm_appointments for select to authenticated
  using (private.is_assigned_trainer(contact_id));
-- Their member's photo, if they have one (signed URLs are made per session).
create policy "crm_private_read_assigned_trainer_photo"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'crm-private'
    and exists (
      select 1 from public.crm_contacts c
      where c.photo_path = storage.objects.name and private.is_assigned_trainer(c.id)
    )
  );

commit;
