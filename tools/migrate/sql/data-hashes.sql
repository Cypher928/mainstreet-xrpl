-- tools/migrate/sql/data-hashes.sql — read-only row-content hashes of the tables a
-- permissions or acquisition migration must not touch. Run BEFORE and AFTER;
-- every line must be identical (a migration that legitimately changes rows must
-- say so in its header, and the difference is then explained, never assumed).
select 'properties' as t, count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') as v from public.properties x
union all select 'acquisition_reviews', count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') from public.acquisition_reviews x
union all select 'acquisition_documents', count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') from public.acquisition_documents x
union all select 'acquisition_document_families', count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') from public.acquisition_document_families x
union all select 'acquisition_term_decisions', count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') from public.acquisition_term_decisions x
union all select 'acquisition_conversion_attestations', count(*)::text from public.acquisition_conversion_attestations
union all select 'organization_members', count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') from public.organization_members x
union all select 'tenants', count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') from public.tenants x
union all select 'lease_documents', count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') from public.lease_documents x
union all select 'property_events', count(*)::text||' '||coalesce(md5(string_agg(x::text, '|' order by x.id)),'-') from public.property_events x
union all select 'financial_sources', count(*)::text from public.financial_sources
union all select 'gl_entries', count(*)::text from public.gl_entries
union all select 'storage.objects', count(*)::text from storage.objects
union all select 'auth.users', count(*)::text from auth.users
union all select 'other sessions in a transaction', count(*)::text from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and (state <> 'idle' or xact_start is not null)
order by 1;
