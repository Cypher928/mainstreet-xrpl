# Pilot migration record — reconciliation manifest

**Project:** Pilot Supabase project `bhmktujbxdbvdmpybmad` (www.mainstreet-review.com).
**Read on:** 2026-09-26 from `supabase_migrations.schema_migrations` (33 rows, read-only;
the 34th and 35th rows, 032 and 033, were applied later the same day by the work that wrote this file;
the 36th and 37th rows, 034 and 035, were applied on 2026-09-27).
**Production** (`zhsuhehgehbzkmzurzyf`) is not described here and was not touched.

This file is a record, not a tool. Nothing reads it. It answers one question for
every migration Pilot has ever recorded: *which committed text produced it, and
how does the recorded SQL differ from that text?* The next migration a person
writes for Pilot takes number **036**; every number up to 035 is spoken for by
one of the two lineages below.

## Method

Each recorded row's `statements` were joined and normalised the same way as each
candidate file: `--` comments removed, standalone `begin;` / `commit;` lines
removed, `$fn$` quoting read as `$$`, all whitespace removed. A row is
**identical** when the two normalised texts hash the same. When they do not, the
two texts were diffed character by character and every differing span is listed
under "Deltas". Candidates were the files at `pilot` HEAD, the copies under
`migrations/phase0/`, and every `.sql` blob in the repository's history across
all remote branches (88 distinct blobs).

Blob hashes below are the first 8 characters of the git blob id of the file that
matched, so the match can be re-checked with `git cat-file -p`.

## Recorded history (46 rows as of 047, in applied order; 040 and 041 are unused; 046 is not applied)

| version | recorded name | source text | match |
|---|---|---|---|
| `20260812114725` | `tenant_users_phase_a` | `migrations/012_tenant_users_phase_a.sql` @ `7ec126c5` | equivalent — D1 |
| `20260812115346` | `tenant_users_phase_a_reapply` | `migrations/012_tenant_users_phase_a.sql` @ `7ec126c5` (same SQL applied a second time, 6 min later) | equivalent — D1 |
| `20260813000357` | `tenant_invitations_b1` | `migrations/014_tenant_invitations.sql` @ `d2c7d3e9` | identical |
| `20260816035943` | `tenant_users_hide_revoked` | `migrations/015_tenant_users_hide_revoked.sql` @ `002f2ab8` | identical |
| `20260816125818` | `b2_tenant_space_profiles` | `migrations/016_tenant_space_profiles.sql` @ `28992b79` — **only on `claude/b2-tenant-portal`** | equivalent — D2 |
| `20260816125843` | `b2_tenant_statements` | `migrations/017_tenant_statements.sql` @ `93f594da` — **only on `claude/b2-tenant-portal`** | equivalent — D3 |
| `20260816125858` | `b2_tenant_documents` | `migrations/018_tenant_documents.sql` @ `360cde10` — **only on `claude/b2-tenant-portal`** | equivalent — D4 |
| `20260903010311` | `019_evidence_quote` | `migrations/019_evidence_quote.sql` @ `ac93b6f1` | identical |
| `20260904175603` | `020_cam_expected_basis` | `migrations/020_cam_expected_basis.sql` @ `e51ff6d8` | identical |
| `20260905140545` | `021_safe_tenant_resync` | `migrations/021_safe_tenant_resync.sql` @ `2d923b8e` | equivalent — D5 |
| `20260905151746` | `022_payment_management` | `migrations/022_payment_management.sql` @ `d6083333` | equivalent — D6 |
| `20260905152109` | `022_payment_management_fidelity_fix` | **no file anywhere.** The recorded SQL is the `payment_record_settlement` function and its grant, and is identical (normalised) to that function as committed in `022_payment_management.sql` @ `d6083333` | identical to a subset of 022 — D7 |
| `20260918013016` | `024_organizations` | `migrations/phase0/024_organizations.sql` — verbatim copy of `migrations/024_organizations.sql` @ `f3b0cf17` on `claude/validation-runs-analysis-ji1zb3` | identical |
| `20260918021657` | `023_property_lifecycle` | `migrations/phase0/023_property_lifecycle.sql` — copy of @ `741d3a23` on the same branch | identical |
| `20260918021814` | `025_document_register` | `migrations/phase0/025_document_register.sql` — copy of @ `b5c4cfe4` | identical |
| `20260918021916` | `026_lease_provisions` | `migrations/phase0/026_lease_provisions.sql` — copy of @ `5d02f185` | identical |
| `20260918023552` | `026b_lease_provisions_privileges` | `migrations/phase0/026b_lease_provisions_privileges.sql` — copy of @ `7e50e3a8` | identical |
| `20260918024036` | `027_evidence_lineage` | `migrations/phase0/027_evidence_lineage.sql` — copy of @ `58ce6f50` | identical |
| `20260918030401` | `029_financial_tables` | `migrations/phase0/029_financial_tables.sql` — copy of @ `d4f22f05` | identical |
| `20260918031414` | `028_property_events` | `migrations/phase0/028_property_events.sql` — copy of @ `59a958ef` | identical |
| `20260918035550` | `028b_property_events_append_only_fix` | `migrations/phase0/028b_property_events_append_only_fix.sql` — copy of @ `fd3657a7` | identical |
| `20260918123140` | `030_property_events_derive` | `migrations/phase0/030_property_events_derive.sql` — copy of @ `67308567` | identical |
| `20260921033639` | `023_acquisition_documents` | `migrations/023_acquisition_documents.sql` @ `44c4df66` | equivalent — D8 |
| `20260921143311` | `024_acquisition_document_classification` | `migrations/024_acquisition_document_classification.sql` @ `80371051` | equivalent — D9 |
| `20260921201418` | `025_acquisition_abstraction` | `migrations/025_acquisition_abstraction.sql` @ `0de8bf07` | identical |
| `20260922010643` | `026_acquisition_term_decisions` | `migrations/026_acquisition_term_decisions.sql` @ `d2e6adc7` | identical |
| `20260922140201` | `027_acquisition_abstraction_error` | `migrations/027_acquisition_abstraction_error.sql` @ `04a6f360` | identical |
| `20260924002758` | `022b_payment_access_scope` | `migrations/022b_payment_access_scope.sql` @ `a0dd7e79` | identical |
| `20260924003020` | `015b_tenant_access_privileges` | `migrations/015b_tenant_access_privileges.sql` @ `93842e48` | identical |
| `20260924003129` | `018b_tenant_portal_privileges` | `migrations/018b_tenant_portal_privileges.sql` @ `595ce32c` — **only on `claude/b2-tenant-portal`** | identical |
| `20260924003230` | `024b_acquisition_document_families_privileges` | `migrations/024b_acquisition_document_families_privileges.sql` @ `cc4ad745` | identical |
| `20260924003313` | `026c_acquisition_term_decisions_privileges` | `migrations/026c_acquisition_term_decisions_privileges.sql` @ `5762974b` | identical |
| `20260924004505` | `031_pilot_requests` | `migrations/031_pilot_requests.sql` @ `9f859dfc` | identical |
| `20260926202507` | `032_resync_property_tenants_property_bound` | `migrations/032_resync_property_tenants_property_bound.sql` @ `2473da81` — applied 2026-09-26 through the Supabase MCP `apply_migration`; the recorded text is the file verbatim, header comments included | identical |
| `20260926223919` | `033_property_lifecycle_integrity` | `migrations/033_property_lifecycle_integrity.sql` @ `516ef3a2` — applied 2026-09-26 through the Supabase MCP `apply_migration`; the recorded text is the file verbatim | identical |
| `20260927032753` | `034_property_at_new_acquisition` | `migrations/034_property_at_new_acquisition.sql` @ `6c3eca61` — applied 2026-09-27 through the Supabase MCP `apply_migration`; the recorded text is the file verbatim (md5 `bc755162…` on both sides) | identical |
| `20260927132042` | `035_acquire_property` | `migrations/035_acquire_property.sql` @ `818c1804` — applied 2026-09-27 through the Supabase MCP `apply_migration`; the recorded text is the file verbatim (md5 `69bde81d…` on both sides) | identical |
| `20260929090159` | `036_acquisition_episode_frozen` | `migrations/036_acquisition_episode_frozen.sql` @ `3bdd558d` — applied 2026-09-29 through the Supabase MCP `apply_migration`; the recorded text is the file verbatim (md5 `02908aee…` on both sides) | identical |
| `20260929220633` | `039_register_leasehold_link` | `migrations/039_register_leasehold_link.sql` @ `252b20ba` — applied 2026-09-29 through the Supabase MCP `apply_migration`, after the client/API change in the same commit was live on Pilot; the recorded text is the file verbatim (md5 `48016063…` on both sides) | identical |
| `20260929231137` | `042_register_relink_deterministic` | `migrations/042_register_relink_deterministic.sql` @ `5b8ae787` — applied 2026-09-29 through the Supabase MCP `apply_migration`; the recorded text is the file verbatim (md5 `528bdc61…` on both sides) | identical |
| `20260930003001` | `037_leasehold_lifecycle` | `migrations/037_leasehold_lifecycle.sql` (committed on `pilot` together with this entry) — applied 2026-09-30 through the Supabase MCP `apply_migration`; the recorded text is the file verbatim (md5 `150d7cfe…` on both sides). Applied after 039 and 042: the number 037 was reserved for this layer | identical |
| `20260930181412` | `038_leasehold_protection` | `migrations/038_leasehold_protection.sql` @ `b560762b` (commit `a7750cc`) — applied 2026-09-30 through the Supabase MCP `apply_migration`, after `a7750cc` was live on Pilot; the recorded text is the file verbatim (md5 `00055957…` on both sides) | identical |
| `20260930235937` | `043_leasehold_absorption` | `migrations/043_leasehold_absorption.sql` @ `daea15ec` (commit `938db31`) — applied 2026-09-30 through the Supabase MCP `apply_migration`, before `938db31` was pushed (043 changes no product file, so no client had to be live first); the recorded text is the file verbatim (md5 `f79fc081…` on both sides) | identical |
| `20261003173521` | `044_acquisition_conversion_safeguards` | `migrations/044_acquisition_conversion_safeguards.sql` @ `a8bd444f` (commit `07654ce`, unchanged at `58a390b`) — applied 2026-10-03 through the Supabase Management API (`POST /v1/projects/{ref}/database/migrations`, the endpoint the MCP `apply_migration` tool uses), sent once from the operator's machine with `Idempotency-Key` `a058abd0-dca7-4636-853b-3a07930806c7`, which this row records in `idempotency_key` (every earlier row has null there); applied before the four `pilot` commits carrying it were pushed; the recorded text is the file verbatim (md5 `4dbff7aa…` on both sides, 44,504 characters) | identical |
| `20261004184427` | `045_acquisition_member_write_rules` | `migrations/045_acquisition_member_write_rules.sql` @ `42f0f046` (commit `0317644`; the file was uncommitted at apply time and was committed unchanged; md5 `5ee57195…`, sha256 `39311540…`, 19,462 bytes) — applied 2026-10-04 by the operator from her Mac with `apply-045-pilot.sh` (now `tools/migrate/apply-migration.sh`) through the Supabase Management API `POST /v1/projects/{ref}/database/migrations`, sent once with `Idempotency-Key` `82ffaede-02cb-497e-9bd5-ab8f1d490b87` (recorded in `idempotency_key`), HTTP 200 at 18:44:27Z; the token was a scoped personal access token holding only Database → Migrations read-write on Pilot; two earlier `apply_migration` calls through the Supabase connector timed out at 60 s with no effect (the connector's destructive-SQL confirmation cannot be shown in this client); the recorded text is the file verbatim (md5 `5ee57195…` on both sides, 19,462 bytes) | identical |
| `20261005183007` | `047_member_write_rules_remaining` | `migrations/047_member_write_rules_remaining.sql` (commit `979306a`; md5 `2c6b8a07…`, sha256 `a49725da…`, 8,941 bytes) — applied 2026-10-05 by the operator from her Mac with `tools/migrate/apply-migration.sh` through the Supabase Management API `POST /v1/projects/{ref}/database/migrations`, sent once with `Idempotency-Key` `473bd7a4-9ea6-4dbc-8cee-075e1edb8e3b` (recorded in `idempotency_key`), HTTP 200 at 18:30:07Z; 046 was not applied before it (047 needs only 045 and phase0/024); the recorded text is the file verbatim (md5 `2c6b8a07…` on both sides, 8,941 bytes) | identical |

Tally (46 rows as of 047): 36 identical, 9 equivalent with every delta listed below, 1 with no file
of its own (D7). No recorded statement is unexplained.

## Deltas (every differing span, after normalisation)

None of these changes a table, column, constraint, index, policy, grant or
function body. Three change what the live catalog says in a `comment on`
string; two change the text of an exception that is raised only when the
migration is run against a project that is not Pilot.

- **D1 — 012 (both rows).** Two `comment on` strings: the em dash `—` in the
  file became `-` in the recorded text. Nothing else. The live catalog comment
  on `tenant_users` and on `tenant_ids_for_current_user()` therefore carries a
  hyphen where the file has an em dash.
- **D2 — 016.** Two `comment on` strings: em dash → hyphen. Nothing else.
- **D3 — 017.** (a) The Pilot guard message was shortened from
  `'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad).'`
  to `'REFUSING TO RUN: pilot marker property not found.'`. (b) Three
  `comment on` strings were shortened: `...at publish time by api/tenant-publish-statement.js and...`
  → `...at publish time and...`; `...its run hash, its revision chain and who published it. NO TENANT POLICY — ...`
  → `...its run hash, revision chain and publisher. NO TENANT POLICY - ...`;
  `...Performs NO authorization — api/tenant-publish-statement.js has already proven ownership...`
  → `...Performs NO authorization - the endpoint has already proven ownership...`.
  The `publish_tenant_statement` body is identical.
- **D4 — 018.** (a) Same guard-message shortening as D3. (b) Two `comment on`
  strings: `Carries display metadata only` → `Display metadata only`;
  `...zero rows for a tenant by construction. Read only by the landlord and by api/tenant-document-url.js with the service role.`
  → `...zero rows for a tenant by construction.`; em dash → hyphen.
- **D5 — 021.** The file's trailing verification query
  (`select routine_name, security_type, ... from information_schema.routines ...`)
  was not recorded. The function and both grants are identical.
- **D6 — 022.** The file's trailing verification query (the three-count
  `select ... as tables_created, ... as payment_procs, ... as policies`) was not
  recorded. Everything else is identical.
- **D7 — 022 fidelity fix.** Applied 3 minutes after 022. Its whole text is
  `create or replace function public.payment_record_settlement(...)` plus the
  matching `grant execute`, and it is identical (normalised) to that function
  in the committed 022 file. It re-stated a comment line inside the function
  body (`-- Recomputed inside this transaction from the actual non-voided rows.`)
  that the first apply had dropped, so the stored `prosrc` matches the file.
  Replaying 022 from the file yields the post-fix state directly.
- **D8 — 023 (acquisition).** The file's trailing
  `select count(*) as acquisition_documents_rows from public.acquisition_documents;`
  was not recorded. Everything else is identical.
- **D9 — 024 (acquisition).** Function bodies were quoted `$fn$` in the
  recorded text and `$$` in the file. Identical otherwise.

## Applied but not recorded

These files were applied through the SQL editor or the bundle
(`docs/pilot-migrations-bundle.sql`) and do not appear in
`schema_migrations`. Their objects are present on Pilot.

`000_base_schema`, `001_lease_jobs`, `002_evidence_audit_tables`,
`003_cam_reconciliations`, `004_lease_intelligence`, `005_rls_hardening`,
`006_acquisition_reviews`, `007_fix_acq_review_status`,
`008_database_hardening` (and `008b`, which is verification only),
`009_atomic_tenant_resync`, `010_property_archive`,
`011_private_document_buckets`, `013_tenant_users_revoke_anon`.

## Facts a later migration must respect

1. **Two lineages share the numbers 023–027 and both are applied.** The
   acquisition lineage (`023_acquisition_documents` … `027_acquisition_abstraction_error`)
   lives in `migrations/`. The Phase 0 lineage (`023_property_lifecycle` …
   `030_property_events_derive`) lives verbatim under `migrations/phase0/`,
   copied from `claude/validation-runs-analysis-ji1zb3` (tip `5fdc98e`; blob
   ids listed above), and that branch was **not merged**. No applied
   file has been renamed or renumbered; Supabase keys history by version, so the
   database never saw a collision. **The next free number is 036.**
2. **Phase 0 was applied out of filename order:** 024 before 023, and 029
   before 028. A replay by filename has not been exercised.
3. **Since 033, `tenants.property_id` is immutable by trigger, a family is bound to one episode by
   `(family_id, review_id)` foreign keys, and `properties.lifecycle_stage` moves only along the locked
   model (prospect → acquired inside `acquire_property` only, prospect ↔ passed, legacy → prospect).**
   The Phase 0 five-value CHECK is unchanged; `under_review` and `due_diligence` are refused as targets.
4. **`resync_property_tenants` on Pilot is 022's version, not 021's.** 021
   created it; 022 replaced it with the same body plus `payments` in the
   retention check and the delete guard. A migration that changes this
   function must start from the live definition (`pg_get_functiondef`), not
   from `021_safe_tenant_resync.sql`. 032 did exactly that; its rollback file is
   the pre-032 live definition. Since 032, the live body is the 032 file's.
5. **Four applied migrations have no source on `pilot`:** 016, 017, 018 and
   018b exist only on `claude/b2-tenant-portal` (tip `c237080`). `022_payment_management.sql`
   on `pilot` has a foreign key to `tenant_statements`, which only 017 creates,
   so `pilot`'s own migration set cannot build Pilot's schema without them.
6. **Six migrations are Pilot-only by construction.** 012, 014, 015, 016, 017
   and 018 raise unless the Pilot marker property exists. They cannot run on
   Production as written.
7. **`006_acquisition_reviews.sql` has a second, divergent version** on
   `feature/acquisition-review` (blob `a2c087a5`); Pilot has the `pilot`/`main`
   version.
8. **Since 034 (P3), a deal is a property from its first minute.** A prospect
   property and its acquisition episode are created only by
   `begin_acquisition(name, data, organization?, review_id?)`; a direct INSERT of
   a `prospect` row or of an `acquisition_reviews` row is refused by trigger.
   `acquisition_documents`, `acquisition_document_families` and
   `acquisition_term_decisions` carry `property_id NOT NULL → properties ON DELETE
   RESTRICT`, filled from the review by trigger; an open episode always has a
   property (CHECK) and a property has at most one open episode. The four
   owner-only acquisition policies were replaced by property-membership policies
   (`member_property_ids()`). `delete_prospect_acquisition(review_id)` is the
   only path that removes a deal and its prospect (admin only; refused when the
   episode holds a confirmed document, a confirmed family or any decision).
   Backfill on 2026-09-27: 7 open reviews received a new prospect each
   (`data._p3Backfill`), 3 converted reviews were linked to their existing
   property — including `aca00000-0000-4000-b000-011df998bad2`, whose status was
   corrected from `complete` to `converted` on the evidence of its own
   `conversionRecord` (left intact) — and the one converted review whose
   property no longer exists keeps `property_id` null. The backfill UPDATE
   stamped `updated_at` on those 10 reviews (the `acq_reviews_updated_at`
   trigger). **Acquisition membership access is read-capable in P3. Child-record
   authorship remains review-owner-bound by existing composite user FKs
   (`acquisition_documents_review_fk`, `acq_doc_families_review_fk`,
   `acq_term_decisions_review_fk` are `(review_id, user_id)` keys); a member's
   insert under their own `user_id` is refused by those keys. General member
   write attribution is deferred to a separately reviewed identity/authorship
   migration.** 034 changed none of those keys, no child `user_id` semantics and
   no actor trigger.
9. **Since 035 (P4), Acquire is a transition on the same property, never a
   copy.** `acquire_property(property_id, review_id, snapshot)` is one SECURITY
   DEFINER transaction: admin-only (`is_property_admin`), prospect and open
   episode required, at least one leasehold, the client's integrity gate ported
   structurally (no pending document, no unresolved extraction), the supplied
   roster validated structurally (one row per leasehold of this review on this
   property; no duplicate, missing, extra, cross-review or cross-property row;
   a tenant row already under another property is never re-pointed). It then
   moves the SAME `properties` row prospect → acquired through 033's setting,
   upserts one `tenants` row per leasehold with `tenants.id = leasehold id`,
   preserves `properties.data` while carrying the episode's invoices once
   (`sourceEpisodeId`, `acquiredAt`) and storing the roster under
   `data.tenants`, marks the review `converted` (status, `converted_at`,
   `conversionRecord` naming the same property, one `converted` activity
   entry), and writes exactly one `property_events` row. Lease terms are not
   interpreted in SQL; the JavaScript resolver remains the only one. No
   `properties` INSERT, no `tenants.leasehold_id`, no change to 032's resync,
   to any composite key, to RLS, memberships, payments, settlement, XRPL or
   auth. Applied 2026-09-27 with no data change (every table hash identical
   before and after); the live rolled-back matrix passed 28/28 including two
   injected mid-transaction failures that left nothing behind. The temporary
   client guard on the legacy Acquire path stays in place until the in-place
   path is proven in the browser.
10. **Since 036 (P5-6A), a converted acquisition is frozen.** An
   `acquisition_reviews` row with `status = 'converted'`, and every
   `acquisition_documents`, `acquisition_document_families` and
   `acquisition_term_decisions` row naming it, refuses INSERT / UPDATE / DELETE
   for every role, service role included (`acq_reviews_frozen`,
   `acq_children_frozen`, predicate `_acq_episode_frozen`; errcode 23000). The
   only writes admitted are a foreign key's own cascade or SET NULL (trigger
   depth > 1) and the exact legacy-revert shape (property already gone, status
   → complete, only the conversion bookkeeping keys changed), which 034's
   validated CHECK `acq_reviews_open_has_property` already refuses on Pilot,
   so it is unreachable today. `acquire_property` is unaffected (it updates an
   open review). anon lost its unused privileges on `acquisition_reviews` and
   `acquisition_documents`; the rollback does not re-grant them. No RLS policy,
   membership predicate, column, constraint, index, data or 028–035 function
   changed. Applied 2026-09-29 with no data change (catalog outside 036 and
   every table hash identical before and after). Verified live in rolled-back
   transactions: the matrix passed 200/200 (owner, org member, org admin, anon,
   stranger and service role on a converted episode, an open episode, an
   in-transaction acquire with an injected failure, cascades and the revert
   path with the CHECK present and lifted); the rollback rehearsal removed
   exactly 036's objects and left the rest of the catalog identical. Note for
   later migrations: on Pilot the service role holds no privilege on
   `acquisition_document_families` or `acquisition_term_decisions` (024b/026c
   grant them to `authenticated` only). A deliberate correction of a converted
   episode must lift the freeze inside its own transaction, on the record.
11. **Since 039, `lease_documents.tenant_id` is a property-scoped link to the
   leasehold.** `lease_documents_leasehold_fk` is `(tenant_id, property_id)` →
   `tenants (id, property_id)`, ON UPDATE / ON DELETE NO ACTION, **NOT VALID**:
   the 91 historical values that resolve to no tenant were not checked, not
   changed and not declared valid; every new INSERT, and every UPDATE that
   changes `tenant_id` or `property_id`, is checked (service role included).
   A tenant a document is linked to cannot be deleted on its own; deleting a
   property still cascades tenants and documents in one statement.
   `resync_property_tenants` retains register-linked tenants (prosrc md5
   `dd782746…`; SECURITY DEFINER, `search_path`, owner and ACL unchanged).
   `lease_documents.legacy_tenant_id` (uuid, nullable) exists and is empty;
   only a separately approved relink (042) may fill it, and the rollback
   refuses once it holds a value. Applied 2026-09-29 after the client/API
   change in the same commit was live, with no data change: every public table
   hash (lease_documents on its original columns), storage objects, policies,
   RLS flags, table grants, other constraints and other functions identical
   before and after; the 53-row 042 candidate set still proves 53/53. Do not
   `VALIDATE` the constraint while any historical row is undecided.
12. **Since 042, 53 register rows are linked and carry their old value.**
   Exactly the 53 rows approved from the 042 dry run (a fixed list of
   document / expected tenant_id / proposed tenant triples in the file; no
   rule selected them) now name the leasehold they were uploaded as, of their
   own property, and hold the audited historical value in `legacy_tenant_id`.
   Every row was re-proved in the transaction against the dry run's evidence
   (single job whose id is the tenant, same stored upload on both sides, one
   storage object, target unclaimed, not Miracle Mile). The other 38
   historical rows — 9 Miracle Mile List A, 11 List B, 4 List C (Prime
   Wellness `6f09adbf…` among them) and 14 List D — and the one empty row are
   byte-identical and still unresolved; `lease_documents_leasehold_fk` stays
   **NOT VALID**. The table's own BEFORE UPDATE trigger set `updated_at` on the
   53. Applied 2026-09-29 with every other table, storage, policies, grants,
   RLS flags, constraints, functions and columns identical before and after.
   The 042 rollback restores the 53 values exactly (it drops and re-adds the
   identical NOT VALID constraint in its transaction) and refuses once any of
   the 53 has moved on; 039's rollback refuses while `legacy_tenant_id` holds
   values, so 042 must be rolled back first.
13. **Since 037, a leasehold carries a lifecycle, and every leasehold is
   active.** `tenants.leasehold_status` (text, NOT NULL, default `active`),
   `ended_at` (date) and `ended_reason` (text) exist, with
   `tenants_leasehold_status_chk` (active | ended),
   `tenants_ended_consistency_chk` (active ⇒ both null; ended ⇒ both set) and
   `tenants_ended_reason_chk` (lease_expired | terminated_early | surrendered |
   evicted | other — no `assigned`: an assignment does not end a leasehold).
   The column is `leasehold_status`, not `status`, because the client's tenant
   records already use `status` for extraction state. `ended_at` is the
   confirmed actual end entered by a person and is never inferred from
   `end_date`; it may be later than `end_date` (holdover). Nothing writes these
   columns yet — ending, reactivating and discarding are 038, separately
   approved. Applied 2026-09-30 with no data change: all 149 tenants read
   active / null / null, their eleven existing columns and every other table,
   storage, policy, grant (table and column), RLS flag, constraint, function,
   index and trigger identical before and after. The rollback refuses while any
   leasehold is ended or any function reads `leasehold_status`.
14. **Since 038, a leasehold is permanent: nothing deletes it for leaving a
   list, and its lifecycle changes only by a person's decision.**
   `resync_property_tenants` (prosrc md5 `52ab0f93…`; SECURITY DEFINER,
   `search_path=public`, owner and ACL unchanged) never deletes: an active
   leasehold missing from a roster is left as it is and reported in
   `absent_active`; an ended leasehold in a roster is not written and is
   reported in `ended_in_roster`; `deleted` is always 0. `tenants_delete_guard`
   (BEFORE DELETE) refuses every direct delete for every role, table owner and
   service role included; only a whole-property cascade
   (`pg_trigger_depth() > 1`) or `discard_leasehold` (a transaction-local flag
   naming exactly one row) passes. `tenants_lifecycle_guard` (BEFORE INSERT OR
   UPDATE OF `leasehold_status`, `ended_at`, `ended_reason`) keeps new rows
   active and lets the lifecycle change only through `end_leasehold` /
   `reactivate_leasehold`; an update that names those columns without changing
   them passes. `end_leasehold`, `reactivate_leasehold` and
   `discard_leasehold` are owner-only (`properties.user_id = auth.uid()`),
   SECURITY DEFINER with `search_path=public`, executable by `authenticated`
   and `service_role` only, and each writes a `leasehold_*` property event;
   `discard_leasehold` is refused while CAM, provisions, review audit,
   payments, portal rows, history events or person-reviewed evidence exist
   (`reviewed_at` alone is not a review), keeps the documents unlinked and
   never touches `legacy_tenant_id`. The two trigger functions are executable
   by no API role. Applied 2026-09-30 with no data change: every public table
   hash, storage, policies, table and column grants, RLS flags, constraints,
   columns and indexes identical before and after; functions 92 → 97,
   triggers 32 → 34 and function comments 6 → 10, the pre-existing ones
   identical; 149/149 leaseholds active. Verified live the same day in
   rolled-back transactions only, with every table hash identical afterwards:
   direct deletes refused for the table owner, the property's owner through the
   API role and the service role, one row and all of a property's rows, and a
   discard flag naming another row; direct lifecycle changes and an ended
   insert refused for the same roles; the owner still reads the property and
   its five leaseholds, a stranger reads none; a resync naming one of five
   leaseholds returned `deleted: 0` with the other four in `absent_active`;
   `end_leasehold`, `reactivate_leasehold` and `discard_leasehold` refused
   without a user, for a stranger, for an unknown id, without an actual end
   date, for `assigned`, on an active leasehold, on a CAM-referenced leasehold,
   without a note, and for `anon`. No leasehold was ended, reactivated,
   discarded or deleted. The rollback restores 039's resync byte for byte and
   drops the two triggers and five functions; it does not undo an ending or a
   discard, and after it the 039 resync prunes unreferenced absentees again.
15. **Since 043, a duplicate or fragment leasehold can be absorbed into another
   leasehold of the same property, and a discarded leasehold is not
   re-created.** `tenants.absorbed_into` (uuid), `absorbed_reason` (text:
   duplicate | document_of) and `absorbed_at` (timestamptz) exist;
   `tenants_leasehold_status_chk` is active | ended | absorbed;
   `tenants_lifecycle_consistency_chk` replaces 037's
   `tenants_ended_consistency_chk` with a three-way rule;
   `tenants_absorbed_into_fk` points `(absorbed_into, property_id)` at
   `tenants(id, property_id)`, so only a leasehold of the same property, never
   itself. `properties.data_revision` (bigint, NOT NULL, default 0) is kept by
   the `properties_data_revision` trigger: +1 when name, sqft or data changes;
   whatever a caller sends is ignored. The 043 bodies are
   `resync_property_tenants` `de53ec60…`, `tenants_lifecycle_guard`
   `d5e88f82…` and `discard_leasehold` `b49f5c09…`. The resync skips absorbed
   and discarded ids in a stale roster and reports them in
   `absorbed_in_roster` / `discarded_in_roster`. `tenants_absorbed_freeze`
   keeps an absorbed row unchanged for every role. `tenants_tombstone_guard`
   refuses to re-insert an id whose only tombstone is `discard_leasehold`'s
   own `leasehold_discarded` event. `absorb_leasehold`,
   `restore_absorbed_leasehold` and `absorb_leasehold_preflight` are
   owner-only, SECURITY DEFINER with `search_path=public`, and executable by
   `authenticated` and `service_role` only. `leasehold_history` /
   `has_meaningful_history` and the other internal and trigger functions are
   executable by no API role. Absorbing and restoring are bookkeeping, not
   history: a leasehold absorbed and restored by mistake can still be
   discarded. `tenants_delete_guard`, `end_leasehold` and
   `reactivate_leasehold` are unchanged.
   Applied 2026-09-30 with no data change:
   - every public table hash (on its pre-043 columns), storage and auth users
     identical before and after;
   - policies, RLS flags, table grants, constraints outside `tenants`, columns
     outside the four new ones, and the 95 functions 043 does not touch are
     identical;
   - columns 456 → 460, constraints 213 → 216, functions 98 → 109,
     indexes 148 → 150, triggers 34 → 37;
   - 0 leaseholds absorbed, `data_revision` 0 on all 48 properties.

   Verified live the same day in rolled-back transactions only. Afterwards
   there were no probe rows, documents or events, and every table hash was
   unchanged.
   - Direct writes of the absorption columns, and a leasehold inserted
     absorbed, were refused for the table owner, the property's owner through
     the API role and the service role.
   - absorb / restore / preflight were refused for a stranger and for `anon`.
   - These absorbs were refused: the demo leasehold, two leaseholds with
     permanent history, and a cross-property target. Discarding a leasehold
     with history was also refused.
   - A full cycle on two probe leaseholds:
     - refused for a stale revision, an unknown reason, an empty note, and a
       linked document left behind;
     - absorb moved the document, removed the roster entry and wrote both
       events;
     - the absorbed row was frozen, and could not be deleted, re-absorbed or
       discarded;
     - a stale resync reported it in `absorbed_in_roster` and left it
       untouched;
     - restore returned the row, document and roster entry;
     - a discard then succeeded;
     - a stale resync reported it in `discarded_in_roster` without
       re-creating it;
     - plain and upsert re-inserts were refused.

   No real leasehold was absorbed, restored, ended or discarded. The rollback
   restores 038's three bodies byte for byte and 037's two checks, and refuses
   while any leasehold is absorbed.
16. **Since 044, the server enforces the matching and missing-lease safeguards
   before an acquisition is converted.** `acquisition_conversion_attestations`
   exists (10 columns: id, review_id, property_id, family_id, kind, row_key,
   reason, verifies_terms, acted_by, created_at; 8 constraints, among them
   `acq_attestations_verifies_nothing` (`verifies_terms = false`),
   `acq_attestations_row_key_check` and the composite foreign key
   `(family_id, property_id)` → `acquisition_document_families(id, property_id)`
   ON DELETE CASCADE). It is append-only (`acq_attestations_append_only`
   BEFORE UPDATE OR DELETE; a delete passes only one trigger level down, from
   a cascade), stamped and scoped by `acq_attestations_guard` (BEFORE INSERT:
   `acted_by` and `created_at` are set by the database; only the property's
   owner or an active, non-`read_only` member may insert; only an open review;
   `no_document_on_file` is refused while a live lease document is filed;
   `match_confirmed` names a real extracted entry and needs a reason when the
   server's own comparison finds a material mismatch), and carries 034's
   `acq_attestations_property_bind` and 036's `acq_children_frozen`. Indexes:
   pkey, `idx_acq_attestations_review`, `idx_acq_attestations_family` and the
   partial unique `acq_attestations_one_ack_per_leasehold` (review_id,
   family_id) WHERE kind = 'no_document_on_file'. RLS on; `authenticated` may
   SELECT and INSERT rows of properties in `member_property_ids()`; `anon` has
   nothing. (`service_role` holds the platform's default full table
   privileges on this table, as it does on `acquisition_documents`; it never
   serves the browser, bypasses RLS everywhere, and the append-only trigger
   fires for it too.) Five pure, immutable, locale-independent functions port
   the page's comparison: `acq_js_trim` `e5a7c4f6…`, `acq_name_tokens`
   `5e56edb2…`, `acq_compare_tenant_names` `1b58b9b8…`, `acq_compare_property`
   `c5e91951…`, `acq_match_requires_reason` `96ea9213…`; the two trigger
   functions are `acq_attestations_guard` `8bb1df25…` and
   `acq_attestations_append_only` `11eff35d…`; all seven `search_path=""`,
   executable by `authenticated` and `service_role` only. `acquire_property`
   is 035's body verbatim with steps 5c (every leasehold with no live lease
   document needs a `no_document_on_file` row for THIS review) and 5d (every
   `matched` resolution the server itself finds materially mismatched needs a
   `match_confirmed` row with a reason for THIS entry) inserted after 5b; its
   body is `3ba209b9…` (21,617 characters), SECURITY DEFINER, `search_path=""`,
   one overload, authorisation still first. `review.data.leaseholdAcknowledgements`
   and resolution `concerns` / `reason` keys are not read by the server. Not
   grandfathered: no acknowledgement was invented for any existing review.
   Applied 2026-10-03 with no data change:
   - every data count and fingerprint (reviews 11, documents 16, families 12,
     term decisions 40, properties 49, tenants 149, property events 84),
     storage objects 198 and auth users 13 identical before and after;
   - the 108 functions 044 does not touch, and the 72 pre-existing policies,
     fingerprint-identical before and after; constraints outside the new
     table 216 → 216;
   - columns 460 → 470, constraints 216 → 224, functions 109 → 116,
     indexes 150 → 154, policies 72 → 74, tables 31 → 32, triggers 37 → 41;
   - 0 attestation rows; 0 reviews carry a client-side acknowledgement map.

   Verified live the same day, read-only:
   - the comparison on Pilot's ICU `en-US` locale behaves as the page's does
     (`SafeShield Security, LLC` vs `Sunrise Cafe & Bakery LLC` → mismatch;
     `LUXE NAILS, L.L.C.` vs `Luxe Nails` → same tenant, also when padded with
     NBSP, ideographic space and tab; a blank acquisition name cannot soften a
     mismatch; an NBSP-wrapped street address → uncertain; `İSTANBUL` →
     `{i,stanbul}`; a reason of only NBSP, ideographic space and U+FEFF trims
     to empty);
   - a read-only mirror of 5c/5d over the six open reviews found 0
     unacknowledged document-less leaseholds and 0 unreasoned mismatches, so
     no open review is blocked by the new gate.

   Until the `pilot` commits carrying 044's client (which records
   acknowledgements through this table) are deployed, the live page still
   writes `leaseholdAcknowledgements` into `review.data`, which the server
   ignores: a conversion needing an acknowledgement would be refused by 5c
   until then. No open review needs one today. The rollback
   (`abd99d7f…`) restores 035's `acquire_property` verbatim and drops the
   table and the seven functions; dropping the table discards every
   acknowledgement and recorded reason.

17. **Since 045, members read and only people who may edit write.** The FOR
   ALL member policies 034 and phase0/024 left on `acquisition_reviews`,
   `acquisition_documents`, `acquisition_document_families`,
   `acquisition_term_decisions` and `properties` are split: SELECT keeps the
   member predicate (read-only members still see everything they saw); INSERT
   and UPDATE need `can_edit_property` (the owner, or an accepted, unrevoked
   organisation member whose role is not `read_only`); review deletion needs
   `is_property_admin`, property deletion likewise. Four guard triggers: a
   review becomes converted only inside `acquire_property`
   (`acq_reviews_conversion_guard`); a review, document, family or decision is
   written by the person it names and `user_id` never changes
   (`acq_children_author_guard`, also `decided_by`); a document's
   `storage_path` is set once (`acq_documents_storage_path_guard`); a signed-in
   save never moves `properties.user_id` or `organization_id`
   (`properties_identity_guard`). `authenticated` lost TRUNCATE on the three
   tables and INSERT on `financial_sources`/`gl_entries` (the 029 member-insert
   policies are dropped); `anon` lost everything on `properties`. No row
   changed. Applied 2026-10-04 (row above) with every table hash identical
   before and after; the catalog diff against the saved item-level inventory
   was 13 removals and 35 additions, all 045's. Verified live the same day in
   one rolled-back transaction with the four test accounts (46 checks,
   `tools/migrate/live-matrix/045_acquisition_member_write_rules.result.txt`):
   reads kept for every member, writes refused for read-only members,
   strangers, revoked and unaccepted members, forged authorship refused,
   direct conversion refused for everyone including the database owner,
   storage path immutable, ownership never moved by an editor's save, TRUNCATE
   and direct ledger inserts refused, `acquire_property` still converts and the
   converted review stays frozen, `delete_prospect_acquisition` cascades.
   **Known limitation, unchanged by 045:** the composite keys
   `(review_id, user_id) → acquisition_reviews(id, user_id)` from 023/024/026
   mean a non-owner cannot file a document, family or decision in their own
   name, and 045 now refuses filing them in the owner's name; an editor
   therefore cannot file child records on a review they do not own by any
   path. The deferred authorship migration (034 fact 8) owns this.
   Procedure: `docs/MIGRATION_RUNBOOK.md`.

18. **Since 047, the lease document register and the organisation storage folders
   follow 045's rule, and the latent grants on the organisation tables are gone.**
   `lease_documents`: the FOR ALL member policy `lease_docs_owner_all` is replaced by
   `lease_docs_member_select` (same member predicate) and `lease_docs_editor_insert` /
   `_update` / `_delete` (`can_edit_property`); `lease_docs_service_role_all` is kept, so
   the server (`api/lease-documents.js`, ask-lease, validate-lease) writes as before.
   `storage.objects`: `docs_owner_insert` / `_update` / `_delete` now use the new
   `storage_object_writable(name)` (your own folder, or an organisation you may edit:
   accepted, unrevoked, not `read_only`; SECURITY DEFINER, empty search_path, executable by
   `authenticated` and `service_role` only); `docs_owner_read` is unchanged. Grants: `anon`
   has nothing on `organization_members`, `organizations`, `lease_documents`;
   `authenticated` keeps SELECT only on the two organisation tables and
   SELECT/INSERT/UPDATE/DELETE on the register. No row changed. The migration role creates
   and drops policies on `storage.objects` (owned by `supabase_storage_admin`) through
   `supautils.policy_grants`. Before the apply, 047, its rollback and this matrix were run on
   Pilot in one transaction forced to abort (2026-10-05): rollback restored the catalog
   exactly. After the apply: record verified, catalog diff 10 removed / 11 added (all 047's,
   inventory digest equal to the prediction), every data hash identical, live matrix 46/0
   (`tools/migrate/live-matrix/047_member_write_rules_remaining.result.txt`).
   **Not closed by 047:** `anon`/`authenticated` still hold every privilege on
   `storage.objects`/`storage.buckets` (latent under row security); 046's two RESTRICTIVE
   rules on acquisition originals do not exist until 046 is applied. Rollback:
   `047_member_write_rules_remaining_rollback.sql` (md5 `088948e7…`), which reopens every gap.

## Decisions this manifest does not make

- Whether 016, 017, 018 and 018b (and their rollbacks) are copied verbatim into
  `migrations/` on `pilot`, the way the Phase 0 lineage was copied into
  `migrations/phase0/`.
- Whether `022_payment_management_fidelity_fix` gets a file of its own (a
  one-function re-statement) or stays a note here.
- Whether the out-of-band applies (000–011, 013) and the duplicate 012 row are
  ever written into `schema_migrations`.
- When Production is restored read-only to learn its actual state.
