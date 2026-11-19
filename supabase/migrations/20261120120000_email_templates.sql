-- Admin > Email > Templates (Adam, 2026-11-19): each studio's header/footer
-- for the emails SynqIQ sends for it, and its own wording for each email.
-- No row = the default wording (lib/email/studio-templates.ts).
create table if not exists email_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  signature text check (signature is null or length(signature) <= 500),
  footer text check (footer is null or length(footer) <= 1000),
  show_logo boolean not null default true,
  updated_by_staff_id uuid references staff (id),
  updated_at timestamptz not null default now()
);

create table if not exists email_templates (
  organization_id uuid not null references organizations (id) on delete cascade,
  key text not null check (
    key in (
      'payment_declined',
      'payment_on_hold',
      'card_expiring',
      'card_expiring_reminder',
      'card_link',
      'rating_request',
      'class_followup_reminder'
    )
  ),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 5000),
  updated_by_staff_id uuid references staff (id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, key)
);

alter table email_settings enable row level security;
alter table email_templates enable row level security;

-- Read: Club Admins. Writes go through the server.
drop policy if exists email_settings_select_admin on email_settings;
create policy email_settings_select_admin on email_settings for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists email_templates_select_admin on email_templates;
create policy email_templates_select_admin on email_templates for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
