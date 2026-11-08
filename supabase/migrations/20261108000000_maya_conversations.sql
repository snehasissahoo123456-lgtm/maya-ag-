-- Maya server-side conversation storage.
-- Client roles receive no direct table access; only the server service-role key may use PostgREST.
create table if not exists public.maya_conversations (
  id text primary key,
  founder_id text not null,
  title text not null default 'New conversation' check (char_length(title) <= 72),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (founder_id, id)
);

create index if not exists maya_conversations_founder_updated_idx
  on public.maya_conversations (founder_id, updated_at desc);

create table if not exists public.maya_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.maya_conversations(id) on delete cascade,
  founder_id text not null,
  role text not null check (role in ('user', 'model')),
  content text not null check (char_length(content) between 1 and 20000),
  created_at timestamptz not null default now()
);

create index if not exists maya_conversation_messages_owner_order_idx
  on public.maya_conversation_messages (founder_id, conversation_id, created_at asc);

alter table public.maya_conversations enable row level security;
alter table public.maya_conversation_messages enable row level security;

revoke all on public.maya_conversations from anon, authenticated;
revoke all on public.maya_conversation_messages from anon, authenticated;
grant all on public.maya_conversations to service_role;
grant all on public.maya_conversation_messages to service_role;

create or replace function public.maya_append_conversation_message(
  p_founder_id text,
  p_conversation_id text,
  p_role text,
  p_content text,
  p_message_id uuid
)
returns public.maya_conversation_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted public.maya_conversation_messages;
begin
  if p_role not in ('user', 'model') then
    raise exception 'Invalid conversation role';
  end if;
  if p_content is null or char_length(p_content) < 1 or char_length(p_content) > 20000 then
    raise exception 'Conversation content must contain 1–20,000 characters';
  end if;

  update public.maya_conversations
    set updated_at = now()
    where id = p_conversation_id and founder_id = p_founder_id;

  if not found then
    raise exception 'Conversation not found for this Founder';
  end if;

  insert into public.maya_conversation_messages (id, conversation_id, founder_id, role, content)
    values (p_message_id, p_conversation_id, p_founder_id, p_role, p_content)
    returning * into inserted;

  return inserted;
end;
$$;

revoke all on function public.maya_append_conversation_message(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.maya_append_conversation_message(text, text, text, text, uuid) to service_role;

-- Persist validated goal plans and their sequential execution state.
create table if not exists public.maya_goal_plans (
  id text primary key,
  founder_id text not null,
  plan jsonb not null,
  status text not null check (status in ('proposed', 'running', 'awaiting_approval', 'completed', 'failed')),
  step_states jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maya_goal_plans_founder_updated_idx
  on public.maya_goal_plans (founder_id, updated_at desc);

alter table public.maya_goal_plans enable row level security;
revoke all on public.maya_goal_plans from anon, authenticated;
grant all on public.maya_goal_plans to service_role;
