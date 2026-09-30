-- ============================================================================
-- 037_leasehold_lifecycle.sql — a leasehold is active until a person confirms
-- that it actually ended
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change. Written against Pilot's LIVE catalog as read on
-- 2026-09-30 (PostgreSQL 17.6): public.tenants has 11 columns and 149 rows.
-- Applied after 039 and 042; the number 037 was reserved for this layer.
--
-- WHY
-- ---
--   tenants.id is the permanent leasehold identity. A leasehold is never
--   deleted merely because it disappears from a roster or source; it can be
--   ENDED, and an ended leasehold stays as historical memory. This file adds
--   the place to record that — and nothing that writes it. The functions that
--   end, reactivate or discard a leasehold, and the delete/resync protection,
--   are 038, separately approved. After 037 every leasehold is active and
--   nothing in the product can change that.
--
-- BEFORE → AFTER (exact inventory)
-- --------------------------------
--   columns      + tenants.leasehold_status text NOT NULL DEFAULT 'active'
--                + tenants.ended_at         date     (nullable)
--                + tenants.ended_reason     text     (nullable)
--   constraints  + tenants_leasehold_status_chk   leasehold_status in (active, ended)
--                + tenants_ended_consistency_chk  active ⇒ both null; ended ⇒ both set
--                + tenants_ended_reason_chk       lease_expired | terminated_early |
--                                                 surrendered | evicted | other
--   comments     + the three columns
--   = everything else untouched: no row value is written or derived (existing
--     rows read the column default, a catalog constant — no table rewrite), no
--     existing column changes, no policy, grant, FK, index, trigger or function
--     changes. The client's extraction field `status` (on the property blob's
--     tenant records) is a different thing and is not touched; that is why the
--     column is `leasehold_status`.
--
-- THE RULES THIS RECORDS
-- ----------------------
--   · ended_at is the CONFIRMED actual end of the leasehold/occupancy, entered by
--     a person. It is never inferred from end_date: a past contractual end_date
--     is an attention condition (a holdover or renewal may exist), not proof.
--     ended_at may legitimately be LATER than end_date (holdover) or earlier
--     (early termination), so no date-order rule is enforced here.
--   · Assignment, amendment and renewal do not end or create a leasehold; there
--     is deliberately no `assigned` reason.
--   · Free-text notes about an ending belong in the leasehold_ended property
--     event (038), not in a column.
--
-- Re-runnable. Rollback: 037_leasehold_lifecycle_rollback.sql (refuses once any
-- leasehold is ended, or once any function reads leasehold_status). Verified by
-- tools/verify-migration-037.js on a throwaway cluster.
-- ============================================================================

begin;

-- ── Guard ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 037 must never be applied to production.';
  end if;
end $$;

-- ── 1 · the three lifecycle columns ────────────────────────────────────────
-- A constant default on a NOT NULL column: existing rows read 'active' from the
-- catalog; no row is rewritten and no value is copied from any other column.
alter table public.tenants add column if not exists leasehold_status text not null default 'active';
alter table public.tenants add column if not exists ended_at         date;
alter table public.tenants add column if not exists ended_reason     text;

-- ── 2 · consistency ────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.tenants'::regclass and conname = 'tenants_leasehold_status_chk') then
    alter table public.tenants add constraint tenants_leasehold_status_chk
      check (leasehold_status in ('active', 'ended'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.tenants'::regclass and conname = 'tenants_ended_consistency_chk') then
    alter table public.tenants add constraint tenants_ended_consistency_chk
      check (   (leasehold_status = 'active' and ended_at is null     and ended_reason is null)
             or (leasehold_status = 'ended'  and ended_at is not null and ended_reason is not null));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.tenants'::regclass and conname = 'tenants_ended_reason_chk') then
    alter table public.tenants add constraint tenants_ended_reason_chk
      check (ended_reason is null
             or ended_reason in ('lease_expired', 'terminated_early', 'surrendered', 'evicted', 'other'));
  end if;
end $$;

comment on column public.tenants.leasehold_status is
  'active until a person confirms the leasehold actually ended; then ended. Never inferred from end_date, '
  'roster absence, dedupe, failed extraction or demo seeds. Assignment, amendment and renewal do not change it. '
  'Not the client''s extraction status. Added by 037.';

comment on column public.tenants.ended_at is
  'The confirmed actual end of the leasehold/occupancy, entered by a person. May be later than end_date '
  '(holdover). Never copied or inferred from end_date. Null while active. Added by 037.';

comment on column public.tenants.ended_reason is
  'Why the leasehold ended: lease_expired | terminated_early | surrendered | evicted | other. Null while active. '
  'An assignment is not an ending. Free text lives in the leasehold_ended property event. Added by 037.';

commit;
