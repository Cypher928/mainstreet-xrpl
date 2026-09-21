# Acquisition Review — Phase 1

**Status:** in progress on `pilot`. Increment **P1-1 shipped**; P1-2 onward
are planned and individually approved before any code. Production (`main`,
mainstreetcam.com, the production Supabase project) is not touched by this
work.

This document is the committed scope of Acquisition Review, the Phase 1 plan
against the code that exists, and the record of decisions still open. It was
written because none of this was in the repository before: the only prior
references were `ROADMAP.md` Phase 3 §3 ("due-diligence handoff"),
`INFORMATION_ARCHITECTURE.md`'s Acquisition subject, and
`PROPERTY_LIFECYCLE.md` §5.

---

## 1. The committed scope

Acquisition Review lets a buyer or their manager take a target property from a
data room of documents to a verified record they can underwrite against, and
then — deliberately — into the acquired-property lifecycle the rest of
MainStreet manages. Nine areas, all in scope for Phase 1 as a whole:

1. **Acquisition Workspace** — create and open a review; a lifecycle with
   stages; one workspace per target; a record of activity on it.
2. **Document Intake** — bulk upload; classification; document *families*
   (one tenant's lease and everything that changed it) with versions:
   original, renewal, extension, amendment, assignment, guaranty, side
   letter, SNDA, estoppel; every source preserved.
3. **Lease Intelligence** — abstraction; governing-term resolution across a
   family; evidence and provenance for every term; missing, conflicting and
   unclear terms surfaced rather than smoothed over.
4. **Financial Intake** — rent roll, general ledger and other financial
   documents; sources preserved; accounting/billing figures never confused
   with contractual lease income.
5. **Needs Attention** — missing documents, unclear or conflicting terms,
   obligations, renewal and option issues, other risks.
6. **Acquisition Report** — what am I buying, what income, what obligations,
   and which documents prove each; verified figures distinguished from
   assumptions and from stabilized/underwritten figures.
7. **The 13-column lease matrix** — one deliverable built from the verified
   terms (a view, not the definition of the data).
8. **Lease Q&A** — deterministic, evidence-traceable; general knowledge is
   never presented as fact about this lease.
9. **Acquisition completion** — a deliberate transition into the
   acquired-property lifecycle, carrying the documents and evidence with it.

### Principles that bind every increment

- **Verified memory.** A value is either backed by a document (with the
  clause), confirmed by a named person, entered by a person, or an unchecked
  AI reading — and it says which (`field-provenance.js`).
- **AI answers from evidence.** A question no document answers is refused,
  with no citation (`api/_ask-lease-contract.js`, ARCHITECTURE_PRINCIPLES §2).
- **Provenance for every important fact.** Report figures name the document
  that proves them or are labelled as assumptions.
- **AI proposes; a person confirms.** An AI correction never silently
  overwrites a verified record.
- **Stability before features.** Each increment ships with its own tests,
  mutation coverage and regression registration, and is approved alone.
- **Do not duplicate Phase 0 infrastructure.** Extraction, provenance, the
  evidence viewer, storage, signed URLs, Ask-the-Lease and the analysis
  engine are reused, not re-implemented.

---

## 2. What already exists (reused, not rebuilt)

| Area | Reused asset |
|---|---|
| Persistence | `acquisition_reviews` (migrations 006/007; owner RLS; `data` jsonb; status `draft · analyzing · complete · converted`) |
| Analysis | `acquisition-engine.js` — rent roll analytics, CAM recovery analysis, renewal / pro-rata risk, citation-backed findings, `buildPropertyFromReview` |
| Extraction | `/api/claude` task registry (`lease_extraction` with its `quotes` channel, `invoice_extraction`); text and vision paths; `LeaseIngest`; `normalizeTenant` → `fieldEvidence` snapshots |
| Provenance | `FieldProvenance` (five states, stale-evidence rule); `tenant_field_evidence` (+ `quote`, migration 019) |
| Governing terms | `LeaseIntelligence.reasonMultiDocumentLease` (tier then date; superseded values; contradictions) |
| Documents | private `leases` bucket, `/api/upload`, `/api/lease-documents`, `/api/document-url`, Evidence Viewer |
| Q&A | `/api/ask-lease` + refusal contract; AI Workspace `acquisitions` intent; Drafting `acquisitionSummary` |
| Lifecycle | conversion, revert-on-delete, orphan repair with `conversionHistory[]` (`PROPERTY_LIFECYCLE.md`) |

---

## 3. The increments

Each is small, separately approved, and verified before the next starts.

| # | Increment | Status |
|---|---|---|
| P1-1 | **Workspace record & lifecycle foundation** — `acquisition-workspace.js`; idempotent `upgradeReview`; stage model; activity model; conditional save with conflict protection; stage chips in the detail header | **shipped** |
| P1-2 | Document Intake I — preserve every source (`acquisition_documents` table, migration 023, `/api/acquisition-documents`, originals in storage, extracted text kept, failed extractions kept as rows) | planned — needs migration authorization |
| P1-3 | Document Intake II — classification, families, versions (server-owned `document_classification` task; families grouped, never guessed; human confirms) | planned |
| P1-4 | Lease Intelligence — abstraction per family, governing terms with state `verified · ai_extracted · missing · conflicting · unclear`; per-field confirm/correct as appended snapshots | planned |
| P1-5 | Financial Intake — rent roll and GL, contractual vs rent roll vs GL side by side, sources kept | planned |
| P1-6 | Needs Attention — ranked, evidence-pointed, gates completion | planned |
| P1-7 | Acquisition Report v2 — buying / income / obligations / proof; verified vs assumption vs underwritten | planned |
| P1-8 | The 13-column lease matrix + CSV, every cell carrying provenance | planned — columns undefined (§6) |
| P1-9 | Lease Q&A over acquisition documents (single document; optionally one family) — same refusal contract | planned |
| P1-10 | Completion — the deliberate transition to an acquired property, carrying documents and evidence | planned |

---

## 4. P1-1 — the review record (shipped)

### The module

`acquisition-workspace.js` is pure (no DOM, no network, no globals) and is the
one owner of the review's shape. `script.js`'s acquisition glue calls it and
applies the result onto the in-memory review object.

### `data` at schema version 2

```
data = {
  schemaVersion:   2,
  stage:           'intake' | 'abstraction' | 'financials' | 'review' | 'report' | 'acquired',
  tenants:         [],        // extracted leases (unchanged from before)
  invoices:        [],        // extracted invoices (unchanged)
  totalSqFt:       0,         // (unchanged)
  documents:       [],        // P1-2 fills this
  families:        [],        // P1-3 fills this
  assumptions:     [],        // P1-7 fills this
  activity:        [],        // see below
  activityCount:   0,         // entries ever recorded
  activityDropped: 0,         // entries trimmed at the cap (honest, not hidden)
  analysis:        null | {}, // (unchanged)
  conversionRecord, conversionHistory, _demoAcq …   // whatever was there stays
}
```

`upgradeReview(row)` brings any stored row to this shape by **adding what is
missing and never removing or rewriting what is present**. It is idempotent
and does not mutate its input. Upgrade happens in memory on load; the
upgraded shape reaches the database with the next real change, so loading a
review writes nothing.

### Stage

The stage is a **recorded decision**. A person sets it from the chips under
the detail header (`setStage`); the acquisition sets `acquired`
(`markAcquired`, from the conversion path) and a reverted conversion
re-derives it (`markReverted`). Rules:

- A converted review (status `converted` with a `conversionRecord`) **is**
  `acquired`, whatever `data.stage` says. Nothing else can be `acquired`.
- An acquired review's stage is locked.
- For a review stored before stages existed, `deriveStage` makes **one**
  initial reading — analysis on file ⇒ `report`; leases, invoices or documents
  on file ⇒ `abstraction`; otherwise `intake` — and that reading is then
  stored. `financials` and `review` are never derived: nothing an old row
  holds can say those happened.
- Running the analysis, uploading files and other acts do **not** move the
  stage. Whether some acts should advance it, and which stage requires what,
  is an open decision for P1-6 (§6).

### Activity

`recordActivity` appends `{ id, at, type, actor: {uid,email} | null, summary,
meta }` and never rewrites an earlier entry. Types today: `review_created`,
`stage_changed`, `documents_added`, `analysis_run`, `converted`,
`conversion_reverted`. The record is capped at 500 entries; when trimmed,
`activityDropped` says how many went and `activityCount` keeps counting.
Actor is the signed-in person or `null` for a system act — never an invented
name.

### Saving without overwriting what you have not seen

Before P1-1 a save was an unconditional upsert of the whole object: the last
writer won, silently. Now:

- `_acqRevs` (in memory) holds, per review, the `updated_at` last **read from
  the database** — from loads, from a conflict reload, and from our own
  inserts. A timestamp this client *sent* in an upsert is never recorded,
  because the `set_updated_at` trigger may have replaced it.
- `_saveAcqReview` issues `UPDATE … WHERE id = ? AND user_id = ? AND
  updated_at = <rev>` with `savePayload(review)` (`name, status, data` — the
  only columns a save writes) and reads back `id, updated_at`.
- `classifySaveResult` turns the response into a verdict. **No row matched
  while filtering on a revision is a CONFLICT**, never a success. The glue
  then reloads the stored row, replaces the in-memory copy, re-renders the
  open panel, and tells the user their last change was not saved. If the row
  is gone it was deleted elsewhere; the review is removed here rather than
  kept as a ghost that can never save.
- With no known revision (a seeded review), the update is unconditional but
  still returns the row's revision, so every later save is conditional. A
  row that does not exist yet falls back to insert-by-upsert.

The verdict is deliberately in code, not in the prompt of a database call:
`test-acquisition-workspace.js` asserts it, and the browser walk in
`test-e2e-acquisition-workspace.js` drives a stale save against a store that
changed underneath it and checks the store is untouched.

---

## 5. Verification

- `test-acquisition-workspace.js` — the module for real (upgrade, stage,
  activity, persistence verdict) plus source-pinned checks that the glue
  saves conditionally, reloads on conflict, adopts read rows, never records
  a sent timestamp, and renders the stage wherever a review is opened.
- `test-e2e-acquisition-workspace.js` — the page, against a Supabase stand-in
  that honours the conditional update and stamps a fresh `updated_at` like
  the trigger: legacy row upgraded on load with nothing lost; chips render;
  a move is saved and attributed and the next save still works; a stale
  save is refused and the stored version shown; a deleted-elsewhere review
  is removed; analysis is recorded; conversion locks the stage; revert
  re-derives it.
- `tools/acquisition-workspace-mutation.js` — 25 mutants across the module
  and the glue; both suites must go red for each.
- Both suites are registered in `test-regression.js`.

---

## 6. Open decisions (recorded, not invented)

Each belongs to the increment that needs it; none is decided here.

| # | Decision | Needed by |
|---|---|---|
| D-2 | **The 13 columns of the lease matrix.** Today's Rent Roll tab shows 8 (Tenant · Suite · Sq Ft · Lease Term · Base Rent/yr · Renewal · Deposit · CAM Structure). The 13 must be supplied. | P1-8 |
| D-3 | **Where acquisition documents live.** Recommended: a new `acquisition_documents` table (additive, isolated). Alternative: relax `lease_documents.property_id` and add `acquisition_review_id`, which touches three ownership checks shared with the managed-property path. Either needs a Pilot migration, authorized explicitly. | P1-2 |
| D-4 | **Team activity / multi-user.** `acquisition_reviews` RLS is owner-only; team access is named in the IA and not implemented. P1-1 records activity for the owner. Sharing and roles are out of scope unless authorized. | later |
| D-5 | **Lifecycle representation.** Done in P1-1 as `data.stage` in jsonb; the `status` column and its constraint are unchanged so Command Center and portfolio actions keep working. Whether `status` should grow is not proposed. | — |
| D-6 | **Obligations and options extraction.** The current contract extracts only `renewal_options` and a boolean `audit_rights`. Adding fields to `lease_extraction` is a shared-contract change under the one-revision-one-re-extraction rule; recommended instead: a separate `acquisition_abstraction` task. | P1-4 |
| D-7 | **Financial intake formats.** Which rent roll / GL sources (Yardi, MRI, Excel, scanned PDF)? Sample files decide the parser. | P1-5 |
| D-8 | **Stabilized / underwritten figures.** Assumed user-entered in-app; not imported from a model. | P1-7 |
| D-9 | **Q&A scope.** Single document, or one family's governing documents? Cross-family questions stay a refusal (ARCHITECTURE_PRINCIPLES §1). | P1-9 |
| D-10 | **Page numbers on extraction evidence.** Extraction quotes carry no page today; capturing one is a contract change. | P1-4 |
| D-11 | **Large scans vs "preserve sources".** Originals over the request-body limit are read but not stored; direct-to-storage upload is new work. | P1-2 |
| D-12 | **Stage gating and auto-advance.** Which stage requires what, and whether any act (analysis run, documents added) should move the stage. P1-1 keeps the stage a manual marker. | P1-6 |
| D-13 | **Existing Pilot reviews.** They upgrade in memory on load and on disk with their next change. Reading their count or shape means touching the Pilot database, which needs authorization. | P1-2 |
