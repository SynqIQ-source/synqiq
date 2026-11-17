-- Agreements signed at checkout. Each membership and personal-training item
-- can point at an agreement template; when it's sold, the buyer reads the
-- agreement (filled in with what they're buying) and signs on the screen
-- (finger/stylus) or types their name and agrees. The exact text signed, the
-- signature and a PDF are kept (lib/agreements).

alter table organizations add column if not exists legal_name text check (legal_name is null or char_length(legal_name) <= 200);
update organizations set legal_name = 'The Preserve Gym LLC' where mindbody_site_id = 561843 and legal_name is null;

create table if not exists agreement_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- Plain text with {{placeholders}} (lib/agreements/render.ts).
  body text not null check (char_length(body) between 1 and 100000),
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff (id)
);
create index if not exists agreement_templates_org_idx on agreement_templates (organization_id);

alter table pos_items add column if not exists agreement_template_id uuid references agreement_templates (id) on delete set null;

create table if not exists agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  template_id uuid references agreement_templates (id) on delete set null,
  template_version integer not null,
  sale_id uuid references pos_sales (id) on delete set null,
  pos_item_id uuid references pos_items (id) on delete set null,
  item_name text not null,
  mindbody_client_id text,
  crm_contact_id uuid references crm_contacts (id) on delete set null,
  client_name text,
  title text not null,
  body text not null, -- exactly what was shown and agreed to
  body_sha256 text not null,
  signer_name text not null,
  method text not null check (method in ('drawn', 'typed')),
  signature_path text, -- drawn signature PNG (crm-private bucket)
  pdf_path text not null, -- signed PDF (crm-private bucket)
  signed_at timestamptz not null default now(),
  staff_id uuid references staff (id), -- who ran the checkout
  ip text,
  user_agent text,
  check (method = 'typed' or signature_path is not null)
);
create index if not exists agreement_signatures_client_idx on agreement_signatures (organization_id, mindbody_client_id, signed_at desc);
create index if not exists agreement_signatures_sale_idx on agreement_signatures (sale_id);

-- Club Admins of the studio read them; everything else goes through the server.
alter table agreement_templates enable row level security;
alter table agreement_signatures enable row level security;
drop policy if exists "agreement_templates_select_admin" on agreement_templates;
create policy "agreement_templates_select_admin" on agreement_templates for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "agreement_signatures_select_admin" on agreement_signatures;
create policy "agreement_signatures_select_admin" on agreement_signatures for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
