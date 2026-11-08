-- Optional semantic retrieval for Maya memory notes.
create extension if not exists vector with schema extensions;

alter table public.maya_memories
  add column if not exists embedding extensions.vector(768);

create index if not exists maya_memories_embedding_hnsw_idx
  on public.maya_memories using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create or replace function public.maya_search_memories(
  p_founder_id text,
  p_query_embedding extensions.vector(768),
  p_limit integer default 20
)
returns table (
  id text,
  category text,
  title text,
  content text,
  created_at timestamptz,
  updated_at timestamptz,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id, m.category, m.title, m.content, m.created_at, m.updated_at,
    (1 - (m.embedding <=> p_query_embedding))::double precision as similarity
  from public.maya_memories m
  where m.founder_id = p_founder_id
    and m.embedding is not null
  order by m.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.maya_search_memories(text, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.maya_search_memories(text, extensions.vector, integer) to service_role;
