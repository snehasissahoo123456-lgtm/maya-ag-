-- Explicit Founder feedback adjusts memory retrieval ranking; it never modifies model weights.
alter table public.maya_memories
  add column if not exists feedback_score numeric(5,4) not null default 0
    check (feedback_score >= -1 and feedback_score <= 1),
  add column if not exists feedback_count integer not null default 0
    check (feedback_count >= 0);

create table if not exists public.maya_memory_feedback (
  founder_id text not null,
  memory_id text not null,
  rating smallint not null check (rating in (-1, 1)),
  updated_at timestamptz not null default now(),
  primary key (founder_id, memory_id),
  foreign key (founder_id, memory_id) references public.maya_memories(founder_id, id) on delete cascade
);

alter table public.maya_memory_feedback enable row level security;
revoke all on public.maya_memory_feedback from anon, authenticated;
grant select, insert on public.maya_memory_feedback to service_role;
revoke update, delete, truncate on public.maya_memory_feedback from service_role;

create or replace function public.maya_record_memory_feedback(
  p_founder_id text,
  p_memory_id text,
  p_rating smallint
)
returns setof public.maya_memories
language plpgsql
security definer
set search_path = public
as $$
declare updated_memory public.maya_memories;
begin
  if p_founder_id is null or char_length(p_founder_id) < 1 then raise exception 'Founder identity is required'; end if;
  if p_memory_id is null or char_length(p_memory_id) < 1 then raise exception 'Memory ID is required'; end if;
  if p_rating not in (-1, 1) then raise exception 'Feedback rating must be -1 or 1'; end if;

  insert into public.maya_memory_feedback (founder_id, memory_id, rating, updated_at)
    values (p_founder_id, p_memory_id, p_rating, now())
  on conflict (founder_id, memory_id) do update
    set rating = excluded.rating, updated_at = now();

  update public.maya_memories m
    set feedback_score = coalesce((
          select avg(f.rating)::numeric(5,4)
          from public.maya_memory_feedback f
          where f.founder_id = p_founder_id and f.memory_id = p_memory_id
        ), 0),
        feedback_count = (
          select count(*)::integer
          from public.maya_memory_feedback f
          where f.founder_id = p_founder_id and f.memory_id = p_memory_id
        )
    where m.founder_id = p_founder_id and m.id = p_memory_id
    returning * into updated_memory;

  if not found then raise exception 'Memory not found for this Founder'; end if;
  return next updated_memory;
end;
$$;

drop function if exists public.maya_search_memories(text, extensions.vector, integer);
create function public.maya_search_memories(
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
  feedback_score numeric,
  feedback_count integer,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id, m.category, m.title, m.content, m.created_at, m.updated_at,
    m.feedback_score, m.feedback_count,
    (1 - (m.embedding <=> p_query_embedding))::double precision as similarity
  from public.maya_memories m
  where m.founder_id = p_founder_id
    and m.embedding is not null
  order by (m.embedding <=> p_query_embedding) - (m.feedback_score::double precision * 0.05) asc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.maya_record_memory_feedback(text, text, smallint) from public, anon, authenticated;
revoke all on function public.maya_search_memories(text, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.maya_record_memory_feedback(text, text, smallint) to service_role;
grant execute on function public.maya_search_memories(text, extensions.vector, integer) to service_role;
