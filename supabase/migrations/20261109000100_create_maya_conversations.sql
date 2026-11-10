-- Maya conversation storage. Access is intentionally server-only.
create table if not exists public.maya_conversations (
  id text primary key check (char_length(id) between 1 and 128),
  founder_id text not null check (char_length(founder_id) between 1 and 128),
  title text not null default '' check (char_length(title) <= 300),
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maya_conversations_founder_updated_idx
  on public.maya_conversations (founder_id, updated_at desc);

alter table public.maya_conversations enable row level security;
revoke all on table public.maya_conversations from anon, authenticated;
grant select, insert, update, delete on table public.maya_conversations to service_role;

create or replace function public.maya_prevent_conversation_owner_change()
returns trigger
language plpgsql
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
