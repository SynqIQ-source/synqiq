-- Guest email replies are accepted from any address that writes to the
-- guest's private reply code (g-<token>@relay domain). When the sender isn't
-- the guest's email on file, the address is kept here so the thread can say
-- who wrote it. Null = the guest's own address (or not an email).
alter table crm_messages add column if not exists from_address text check (from_address is null or char_length(from_address) <= 320);

create or replace function private.crm_messages_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     or new.subject is distinct from old.subject
     or new.channel is distinct from old.channel
     or new.direction is distinct from old.direction
     or new.contact_id is distinct from old.contact_id
     or new.organization_id is distinct from old.organization_id
     or new.sent_by_staff_id is distinct from old.sent_by_staff_id
     or new.from_address is distinct from old.from_address
     or new.created_at is distinct from old.created_at then
    raise exception 'Messages cannot be changed';
  end if;
  return new;
end;
$$;
