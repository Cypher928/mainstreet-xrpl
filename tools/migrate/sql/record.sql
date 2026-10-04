-- tools/migrate/sql/record.sql — read-only: is {{MIGRATION_NAME}} recorded, exactly
-- once, with the approved text? Render with: node tools/migrate/render-sql.js record <name>
-- Expected after a good apply: rows = previous + 1; named = 1; md5 = the approval's
-- sql_md5; bytes = sql_bytes; newest = true; idempotency_key = the key the script
-- printed; previous newest row unchanged.
select 'now' as k, now()::text as v
union all select 'project marker present (Pilot only)', (select count(*) from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600')::text
union all select 'migration rows', count(*)::text from supabase_migrations.schema_migrations
union all select 'rows named {{MIGRATION_NAME}}', count(*)::text from supabase_migrations.schema_migrations where name = '{{MIGRATION_NAME}}'
union all select 'row detail', coalesce(string_agg(version||' | statements='||coalesce(array_length(statements,1),0)||' | md5='||coalesce(md5(statements[1]),'-')||' | sha256='||coalesce(encode(sha256(convert_to(statements[1],'UTF8')),'hex'),'-')||' | bytes='||coalesce(octet_length(statements[1]),0)||' | created_by set='||(created_by is not null)||' | idem='||coalesce(idempotency_key,'null')||' | rollback='||coalesce(array_length(rollback,1),0), ' ;; '), 'none') from supabase_migrations.schema_migrations where name = '{{MIGRATION_NAME}}'
union all select 'is the newest row', coalesce((max(version) = (select max(version) from supabase_migrations.schema_migrations where name = '{{MIGRATION_NAME}}'))::text, 'n/a') from supabase_migrations.schema_migrations
union all select 'previous newest row', version||' '||name||' md5='||md5(statements[1]) from supabase_migrations.schema_migrations where name <> '{{MIGRATION_NAME}}' order by 1 desc limit 1;
