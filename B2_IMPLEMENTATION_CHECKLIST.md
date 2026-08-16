# B2 — implementation checklist

Every B2 requirement and exit criterion, mapped to the migration, endpoint, UI
component and test that satisfies it. Derived from the approved rev-2 design
package; nothing here adds scope beyond it.

**Frozen:** B1's 66 cases and every migration `012`–`015`. If B2 turns out to
require a B1 change, implementation stops and reports rather than changing it.

---

## Sequencing — two stages, because of a deployment dependency

The endpoint cases cannot pass until B2 is deployed to pilot, for exactly the
reason T15/T16 could not during B1: `APP_ORIGIN` is `www.mainstreet-review.com`,
which serves `origin/pilot`, and the routes do not exist there until pilot moves.

| Stage | Runs | Needs a deploy? |
|---|---|---|
| **1 — database layer** | migrations, RLS, projections, `_sources`, write refusals, landlord regression, revoked/pending | no |
| **2 — endpoint layer** | publish / unpublish / supersede round-trip, document URL | yes, to pilot |

Stage 1 must be green before the deploy is proposed. Stage 2 cases report as
`NOT DEPLOYED` failures until then — never as passes.

---

## 1 · Migrations

| # | File | Contains | Rollback |
|---|---|---|---|
| 016 | `migrations/016_tenant_space_profiles.sql` | `tenant_space_profiles` + `tenant_space_profile_sources`, RLS, anon revoke | `016_..._rollback.sql` |
| 017 | `migrations/017_tenant_statements.sql` | `tenant_statements` + `tenant_statement_sources`, partial unique index, publish RPC, RLS, anon revoke | `017_..._rollback.sql` |
| 018 | `migrations/018_tenant_documents.sql` | `tenant_documents` + `tenant_document_sources`, RLS, anon revoke | `018_..._rollback.sql` |

Every migration: pilot-marker guarded (`fd9c09b1-…`), additive only, no
`REVOKE` against `authenticated`, no change to any existing policy.

**Policy shape, all six new tables**

- tenant SELECT — projections only — `tenant_id in (select public.tenant_ids_for_current_user()) and status = 'published'`
- landlord ALL — `property_id in (select p.id from public.properties p where p.user_id = auth.uid())`
- service_role ALL — `true`
- `revoke all … from anon`
- **no tenant policy of any kind on the three `_sources` tables**
- **no tenant INSERT / UPDATE / DELETE policy anywhere**

## 2 · Endpoints

| File | Purpose | Key checks |
|---|---|---|
| `api/_exclusion-block.js` | F-02, server side | `require('cam-exclusions.js')` — the **same UMD module** the browser loads, so the resolver cannot diverge. Only the ack/fingerprint comparison is new. |
| `api/_landlord-auth.js` | shared caller verification | bearer → GoTrue user → `properties.user_id = caller.id` |
| `api/tenant-publish-statement.js` | publish | the twelve ordered checks |
| `api/tenant-unpublish-statement.js` | withdraw | checks 1–5, then `status='void'`; never deletes |
| `api/tenant-publish-document.js` | expose a file | checks 1–5, file belongs to property, `storage_path` written only to `_sources` |
| `api/tenant-document-url.js` | tenant fetch | membership + `status='published'`, one opaque refusal |

**The twelve publish checks** — `tenant-publish-statement.js`

| # | Check | Failure |
|---|---|---|
| 1 | POST + rate limit | 405 / 429 |
| 2 | caller authenticated | 401 |
| 3 | no unexpected fields (no amounts from client) | 400 |
| 4 | caller owns the property | 403 |
| 5 | tenant belongs to that property (composite) | 400 |
| 6 | `cam_year` well formed and equals source year | 400 / 409 |
| 7 | exactly one `cam_reconciliations` row | 409 none / ambiguous |
| 8 | not stale — `reconciled_at >= properties.updated_at` | 409 |
| 9 | F-02 not blocked, incl. stale acknowledgement | 409 |
| 10 | amounts derived from source, required non-null | 409 |
| 11 | `expected_source_hash` matches computed hash | 409 |
| 12 | atomic supersede-and-publish via RPC | 409 |

## 3 · UI — `/portal`

| Component | File | Shows |
|---|---|---|
| Tab nav | `portal.html` | My Space · CAM Statements · Documents |
| My Space | `portal.js` `renderSpace()` | profile fields from `tenant_space_profiles` |
| Statements list | `portal.js` `renderStatements()` | published rows by year |
| Statement detail | `portal.js` `renderStatementDetail()` | totals + `statement_json` line items |
| Documents | `portal.js` `renderDocuments()` | published rows + download via endpoint |
| Empty states | `portal.html` | six states from the design package |

No editable control, no Pay, no Question/Dispute anywhere in B2.

## 4 · Tests

| File | Adds |
|---|---|
| `test-tenant-authz.js` | T22–T5x, real HTTP |
| `scripts/b1-ci-fixture.js` | projection + `_sources` fixtures in every status |
| `test-exclusion-block-port.js` | server F-02 wrapper matches the browser's behaviour |
| `test-b2-contract.js` | static: no tenant policy on `_sources`, no client amount accepted, no `REVOKE … authenticated` in any migration |

---

## Requirement → artefact map

| Requirement | Migration | Endpoint | UI | Test |
|---|---|---|---|---|
| `tenant_space_profiles` | 016 | — | My Space | T36–T39 |
| `tenant_statements` | 017 | publish/unpublish | Statements | T22–T35 |
| `tenant_documents` | 018 | publish-document / document-url | Documents | T40–T47 |
| `_sources` unreadable by tenants | 016–018 | — | — | T56–T58 |
| Server-derived amounts | 017 | publish check 3, 10 | — | T59, T60 |
| Publication lifecycle | 017 index + RPC | publish check 12 | status states | T53c, T55 |
| Tenants never reach `properties` | none — absence of policy | — | — | T48–T50 |
| Tenants never reach source tables | none | — | — | T51 |
| Tenant read-only | none | — | — | T32–T34, T39, T44, T61 |
| Only published visible | 016–018 policies | — | empty states | T23–T25, T37, T41 |

## Exit criterion → test map

| Exit criterion | Cases |
|---|---|
| Tenant isolation | T26, T27, T38, T42, T48–T51, T56–T58 |
| Publication state | T23–T25, T37, T41, T54, T55 |
| Publish boundary — all twelve | T59–T70 |
| Landlord regression | T52, T52b, T52c + B1 T7/T7b/T7c |
| Landlord publishing after new grants | T53, T53b, T53c, T53d — **real HTTP round-trip** |
| Revoked / pending membership | T29, T30, T71, T72 |
| Document visibility | T40–T47 |
| Tenant write surface | T32–T34, T39, T44, T61 — SQLSTATE `42501` specifically |
| Mutation proofing | one named case per mutant |
| Housekeeping | marker guard, rollbacks, teardown to baseline, anon revoked ×6 |

---

## Fail-closed invariants — asserted, not assumed

1. Tenants never receive access to `properties` — no policy exists.
2. Tenants never receive access to landlord source tables.
3. Tenants never receive access to any `_sources` table.
4. Tenants cannot INSERT / UPDATE / DELETE any projection.
5. Only `status = 'published'` rows are tenant-visible, enforced in RLS.
6. Statement amounts are derived server-side and never accepted from a client.
7. No `REVOKE … FROM authenticated` anywhere in B2.
