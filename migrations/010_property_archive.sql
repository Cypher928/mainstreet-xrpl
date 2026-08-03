-- ─── Property Lifecycle: Archive ──────────────────────────────────────────────
-- Archive is the normal end state for a property; Delete is for mistakes only.
-- See docs/PROPERTY_LIFECYCLE.md and docs/ARCHITECTURE_PRINCIPLES.md §4, §5.
--
-- archived_at, not an `archived` boolean and not a status enum:
--   * it answers WHEN, which a boolean cannot, and which the record needs;
--   * `archived_at is null` is the active filter, and indexes cleanly;
--   * an enum invites a third state nobody has defined yet.
--
-- Nullable with no default, so every existing row is Active. There is no
-- backfill and no data migration — an unarchived property is one whose
-- archived_at was never set.

alter table public.properties
  add column if not exists archived_at timestamptz;

-- The portfolio reads active properties for one user on every load, so the
-- index is on the pair. Partial: archived rows are the rare case and are only
-- ever read from the explicit Archived view.
create index if not exists properties_user_active_idx
  on public.properties (user_id)
  where archived_at is null;

comment on column public.properties.archived_at is
  'When the property was archived. NULL = active. Archived properties keep every '
  'lease, timeline entry, document and reconciliation, are hidden from the active '
  'portfolio and excluded from all aggregates, and can be restored. Deletion is a '
  'separate, destructive action reserved for records created by mistake.';

-- RLS is unchanged: the existing per-user policies on public.properties already
-- govern this column. Archiving is an UPDATE by the owner, which those policies
-- already allow — no new policy, and no new way to reach another user's rows.

-- Verify: every existing property is active, and the column is nullable.
select
  count(*)                                        as total_properties,
  count(*) filter (where archived_at is null)     as active,
  count(*) filter (where archived_at is not null) as archived
from public.properties;
