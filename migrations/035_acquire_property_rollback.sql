-- ============================================================================
-- 035_acquire_property_rollback.sql
-- ============================================================================
-- Removes the function 035 added. Nothing else: 035 created no table, column,
-- constraint, index, trigger or policy.
--
-- DATA. An acquisition that ran through acquire_property is a completed
-- lifecycle transition on a real property (prospect → acquired, tenants,
-- carried invoices, a converted episode, one property event). This rollback
-- does not undo any of that — acquired is terminal by 033, and nothing here
-- decides what to do with real work. After this file the client's Acquire
-- fails with "function not found" for a review on a prospect, and the
-- temporary guard (if still present) or the missing RPC keeps the legacy
-- copy-based path from running.
-- ============================================================================

drop function if exists public.acquire_property(uuid, uuid, jsonb);
