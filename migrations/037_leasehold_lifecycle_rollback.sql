-- ============================================================================
-- 037_leasehold_lifecycle_rollback.sql
-- ============================================================================
-- Removes exactly what 037 added:
--   · the three constraints (tenants_leasehold_status_chk,
--     tenants_ended_consistency_chk, tenants_ended_reason_chk);
--   · the three columns (leasehold_status, ended_at, ended_reason) and, with
--     them, their comments.
--
-- REFUSED
--   · once any leasehold is ended (or carries an ended_at / ended_reason):
--     dropping the columns would lose a person's confirmation that a leasehold
--     ended. Such a row must be reactivated through the product first;
--   · once any function in the public schema reads leasehold_status (038 or
--     later): dropping the column would break it. Roll that back first.
--
-- No row is written. No other column, constraint, policy, grant or function is
-- touched.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 037 must never be applied to production.';
  end if;
end $$;

do $$
declare
  v_n integer;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenants' and column_name = 'leasehold_status') then
    execute $q$select count(*) from public.tenants
                where leasehold_status <> 'active' or ended_at is not null or ended_reason is not null$q$ into v_n;
    if v_n > 0 then
      raise exception '037 rollback refused: % leasehold(s) are ended or carry an ending; dropping the lifecycle columns would lose that record', v_n;
    end if;
  end if;
  select count(*) into v_n from pg_proc
   where pronamespace = 'public'::regnamespace and prosrc ~ '\mleasehold_status\M';
  if v_n > 0 then
    raise exception '037 rollback refused: % function(s) in public read leasehold_status; roll those back first', v_n;
  end if;
end $$;

alter table public.tenants drop constraint if exists tenants_ended_reason_chk;
alter table public.tenants drop constraint if exists tenants_ended_consistency_chk;
alter table public.tenants drop constraint if exists tenants_leasehold_status_chk;

alter table public.tenants drop column if exists ended_reason;
alter table public.tenants drop column if exists ended_at;
alter table public.tenants drop column if exists leasehold_status;

commit;
