-- Run after the full migration chain against a disposable PostgreSQL database.
begin;

insert into public.maya_conversations (id, founder_id, title, messages)
values (
  'legacy-backfill-fixture',
  'founder-migration-test',
  'Legacy fixture',
  '[
    {"role":"user","content":"hello from legacy JSON"},
    {"role":"assistant","parts":[{"text":"assistant "},{"text":"turn"}]},
    {"role":"model","parts":[{"functionCall":{"name":"lookup","args":{"q":"x"}}}]}
  ]'::jsonb
);

do $$
declare
  imported integer;
  stored_count integer;
  preserved_count integer;
begin
  imported := public.maya_backfill_legacy_conversations();
  if imported <> 3 then raise exception 'Expected 3 imported messages, received %', imported; end if;

  select count(*) into stored_count
    from public.maya_conversation_messages
    where conversation_id = 'legacy-backfill-fixture'
      and founder_id = 'founder-migration-test';
  if stored_count <> 3 then raise exception 'Expected 3 split messages, received %', stored_count; end if;

  if not exists (
    select 1 from public.maya_conversation_messages
    where conversation_id = 'legacy-backfill-fixture' and role = 'user'
      and content = 'hello from legacy JSON'
  ) then raise exception 'Legacy user content was not preserved'; end if;

  if not exists (
    select 1 from public.maya_conversation_messages
    where conversation_id = 'legacy-backfill-fixture' and role = 'model'
      and content = 'assistant turn'
  ) then raise exception 'Legacy assistant text parts were not joined in order'; end if;

  if not exists (
    select 1 from public.maya_conversation_messages
    where conversation_id = 'legacy-backfill-fixture' and role = 'model'
      and content like '%functionCall%'
  ) then raise exception 'Structured-only legacy parts were not preserved'; end if;

  select jsonb_array_length(messages) into preserved_count
    from public.maya_conversations where id = 'legacy-backfill-fixture';
  if preserved_count <> 3 then raise exception 'Legacy JSONB source was modified'; end if;

  imported := public.maya_backfill_legacy_conversations();
  if imported <> 0 then raise exception 'Backfill is not idempotent; second run imported % rows', imported; end if;
end;
$$;

rollback;
