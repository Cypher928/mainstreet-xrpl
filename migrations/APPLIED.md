# Pilot migration record — reconciliation manifest

**Project:** Pilot Supabase project `bhmktujbxdbvdmpybmad` (www.mainstreet-review.com).
**Read on:** 2026-09-26 from `supabase_migrations.schema_migrations` (33 rows, read-only;
the 34th and 35th rows, 032 and 033, were applied later the same day by the work that wrote this file;
the 36th row, 034, was applied on 2026-09-27).
**Production** (`zhsuhehgehbzkmzurzyf`) is not described here and was not touched.

This file is a record, not a tool. Nothing reads it. It answers one question for
every migration Pilot has ever recorded: *which committed text produced it, and
how does the recorded SQL differ from that text?* The next migration a person
writes for Pilot takes number **035**; every number up to 034 is spoken for by
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

## Recorded history (35 rows, in applied order)

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

Tally: 26 identical, 9 equivalent with every delta listed below, 1 with no file
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
   database never saw a collision. **The next free number is 035.**
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

## Decisions this manifest does not make

- Whether 016, 017, 018 and 018b (and their rollbacks) are copied verbatim into
  `migrations/` on `pilot`, the way the Phase 0 lineage was copied into
  `migrations/phase0/`.
- Whether `022_payment_management_fidelity_fix` gets a file of its own (a
  one-function re-statement) or stays a note here.
- Whether the out-of-band applies (000–011, 013) and the duplicate 012 row are
  ever written into `schema_migrations`.
- When Production is restored read-only to learn its actual state.
