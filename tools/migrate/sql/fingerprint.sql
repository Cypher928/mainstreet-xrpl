-- tools/migrate/sql/fingerprint.sql — read-only catalog fingerprint of everything a
-- migration can touch in public + storage: one md5 per category and the total.
-- Run BEFORE and AFTER an apply (Claude runs it through the Supabase connector's
-- read-only SQL). Identical hashes = nothing moved. col/con/idx/rls should be
-- identical for a policy/grant/trigger migration; fn/pol/pri/trg change by
-- exactly the migration's objects (inventory.sql shows which lines).
with inv as (
  select 'con' as cat, conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace in ('public'::regnamespace,'storage'::regnamespace)
  union all select 'trg', t.tgrelid::regclass::text||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace in ('public'::regnamespace,'storage'::regnamespace) and not t.tgisinternal
  union all select 'fn', p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||coalesce(array_to_string(p.proacl,','),'') from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
  union all select 'col', table_schema||'.'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') from information_schema.columns where table_schema in ('public','storage')
  union all select 'idx', schemaname||'.'||indexname||'|'||indexdef from pg_indexes where schemaname in ('public','storage')
  union all select 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||cmd||'|'||permissive||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname in ('public','storage')
  union all select 'pri', table_schema||'.'||table_name||'|'||grantee||'|'||string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema in ('public','storage') group by table_schema, table_name, grantee
  union all select 'rls', relnamespace::regnamespace::text||'.'||relname||'|'||relrowsecurity::text from pg_class where relnamespace in ('public'::regnamespace,'storage'::regnamespace) and relkind='r'
)
select cat, count(*) as n, md5(string_agg(x, E'\n' order by x)) as md5 from inv group by cat
union all select 'ALL', count(*), md5(string_agg(x, E'\n' order by x)) from inv
union all select 'now', 0, now()::text
order by 1;
