-- Reconcile the split-message repository schema with the older JSON-message migration.
-- The application uses maya_conversation_messages as the source of truth; the JSONB
-- column remains for compatibility with older deployments and must always be an array.
alter table public.maya_conversations
  add column if not exists messages jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maya_conversations'::regclass
      and conname = 'maya_conversations_messages_shape_check'
  ) then
    alter table public.maya_conversations
      add constraint maya_conversations_messages_shape_check
      check (case when jsonb_typeof(messages) = 'array' then jsonb_array_length(messages) <= 5000 else false end);
  end if;
end;
$$;

create or replace function public.maya_prevent_conversation_owner_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.founder_id <> old.founder_id then
    raise exception 'Conversation ownership cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists maya_conversations_owner_immutable on public.maya_conversations;
create trigger maya_conversations_owner_immutable
before update on public.maya_conversations
for each row execute function public.maya_prevent_conversation_owner_change();
