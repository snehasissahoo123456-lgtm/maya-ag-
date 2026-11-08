-- Founder-scoped persistent memory notes with one-time import of the legacy state.json notes.
create table if not exists public.maya_memories (
  id text primary key,
  founder_id text not null,
  category text not null check (category in ('founder_profile','project','design','technical','process','lesson','assumption')),
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (founder_id, id)
);

create index if not exists maya_memories_founder_updated_idx
  on public.maya_memories (founder_id, updated_at desc);

create table if not exists public.maya_memory_imports (
  founder_id text primary key,
  imported_at timestamptz not null default now()
);

alter table public.maya_memories enable row level security;
alter table public.maya_memory_imports enable row level security;
revoke all on public.maya_memories from anon, authenticated;
revoke all on public.maya_memory_imports from anon, authenticated;
grant select, insert, update, delete on public.maya_memories to service_role;
grant select, insert on public.maya_memory_imports to service_role;

create or replace function public.maya_import_legacy_memories(
  p_founder_id text,
  p_memories jsonb
)
returns table(imported boolean)
language plpgsql
security definer
set search_path = public
as $$
declare item jsonb;
declare memory_id text;
declare memory_category text;
declare memory_title text;
declare memory_content text;
declare memory_created timestamptz;
declare memory_updated timestamptz;
begin
  if p_founder_id is null or char_length(p_founder_id) < 1 or char_length(p_founder_id) > 256 then
    raise exception 'Invalid Founder ID';
  end if;
  if p_memories is null or jsonb_typeof(p_memories) <> 'array' then
    raise exception 'Legacy memories must be a JSON array';
  end if;

  insert into public.maya_memory_imports (founder_id)
    values (p_founder_id)
    on conflict (founder_id) do nothing;

  if not found then
    return query select false;
    return;
  end if;

  for item in select value from jsonb_array_elements(p_memories)
  loop
    memory_id := item->>'id';
    memory_category := item->>'category';
    memory_title := item->>'title';
    memory_content := item->>'content';
    memory_created := coalesce(nullif(item->>'createdAt', '')::timestamptz, now());
    memory_updated := coalesce(nullif(item->>'updatedAt', '')::timestamptz, memory_created);

    if memory_id is null or char_length(memory_id) < 1 or char_length(memory_id) > 128 then
      raise exception 'Invalid legacy memory ID';
    end if;
    if memory_category not in ('founder_profile','project','design','technical','process','lesson','assumption') then
      raise exception 'Invalid legacy memory category';
    end if;
    if memory_title is null or char_length(memory_title) < 1 or char_length(memory_title) > 160 then
      raise exception 'Invalid legacy memory title';
    end if;
    if memory_content is null or char_length(memory_content) < 1 or char_length(memory_content) > 20000 then
      raise exception 'Invalid legacy memory content';
    end if;

    insert into public.maya_memories (id, founder_id, category, title, content, created_at, updated_at)
      values (memory_id, p_founder_id, memory_category, memory_title, memory_content, memory_created, memory_updated)
      on conflict (id) do nothing;
  end loop;

  return query select true;
end;
$$;

revoke all on function public.maya_import_legacy_memories(text, jsonb) from public, anon, authenticated;
grant execute on function public.maya_import_legacy_memories(text, jsonb) to service_role;
