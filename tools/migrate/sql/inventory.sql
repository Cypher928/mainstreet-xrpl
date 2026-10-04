-- tools/migrate/sql/inventory.sql — read-only, line-level inventory of the four
-- categories a permissions migration changes (functions, policies, grants,
-- triggers). Save the rows BEFORE and AFTER the apply and diff them: every
-- added or removed line must be one the migration names. The 045 diff was
-- 13 removed / 35 added, all 045's (tools/migrate/live-matrix/045_*.result.txt).
with inv as (
  select 'trg' as cat, t.tgrelid::regclass::text||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid) as x from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace in ('public'::regnamespace,'storage'::regnamespace) and not t.tgisinternal
  union all select 'fn', p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||coalesce(array_to_string(p.proacl,','),'') from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
  union all select 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||cmd||'|'||permissive||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname in ('public','storage')
  union all select 'pri', table_schema||'.'||table_name||'|'||grantee||'|'||string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema in ('public','storage') group by table_schema, table_name, grantee
)
select cat, x from inv order by cat, x;
