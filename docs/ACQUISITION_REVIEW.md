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
| P1-2 | **Document Intake I — preserve every source** — `acquisition_documents` (migration 023), written from the browser under RLS (no new serverless function), originals in the private bucket, text kept, failed extractions kept as rows, Documents panel | **shipped** (migration applied separately) |
| P1-3 | **Document Intake II — classification, families, versions** — migration 024; server-owned `document_classification` task on the existing `/api/claude`; families grouped, never guessed; every reading a proposal until a person confirms it; D-14 answered so a re-upload keeps both sources | **shipped** |
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

## 4b. P1-2 — every source is kept (shipped)

### What changed

`acqHandleLeaseFiles` read each file in the browser, kept the extracted fields
in `review.data.tenants[]`, and threw the source away: no upload, no stored
text, and a failed extraction left no record at all. Now every file gets a row
in `acquisition_documents`, its original goes to the private `leases` bucket,
and the review's Documents panel lists all of them with a control that opens
each stored original.

### Who enforces ownership, and why there is no endpoint

P1-2 first shipped `api/acquisition-documents.js`: a serverless function
holding the service-role key, checking the review's owner before every read and
write, and writing `user_id` from the verified token. **It does not exist.** It
was the thirteenth function in `api/`, and Vercel's Hobby plan deploys twelve —
the build succeeded and the deployment was refused outright
(`exceeded_serverless_functions_per_deployment`). It was removed, and
`acquisition_documents` is now written the way `acquisition_reviews` always has
been: browser to Supabase, signed in, under row-level security.

Nothing was given up, because the endpoint's rule was already the database's:

| the rule | where it lives now |
|---|---|
| a caller sees only their own documents | RLS policy `acq_docs_owner_all`, `user_id = auth.uid()`; **no anon policy** |
| a document may not name an owner its review does not have | the composite foreign key `(review_id, user_id)` → `acquisition_reviews (id, user_id)` |
| one file is one row on a review | `unique (review_id, file_name)`, the upsert's conflict key |
| a status or kind outside the list is refused | the `check` constraints, plus normalisation before the write |

`user_id` is written from the session and never from the fields offered, so a
caller who names somebody else's review produces a `(review_id, user_id)` pair
that does not exist in the parent table and the write is refused with `23503`.
That check now happens below the JavaScript rather than inside it, which is
what the composite key was added for in the first place.

`acquisition-documents.js` (a pure module, loaded before `script.js`) holds what
a write may set, which columns a list asks for, and how an absent table is
recognised. `script.js`'s `_acqLoadDocuments` and `_acqSaveDocument` apply it
through the authenticated client. Later increments need no function either:
P1-3's classification extends `/api/claude` with a task, and P1-9's Q&A extends
`/api/ask-lease`.

### The order, which is the point

1. **The row first**, `parsing_status: 'pending'`. That a file arrived is a
   fact; a tab closed mid-extraction must not lose it.
2. The original goes to storage while the text is read — neither waits on the
   other.
3. The extraction lands and **updates that same row** (the upsert key is
   `(review_id, file_name)`, so one file is one row).
4. A failure updates it to `failed` **with its reason**, and keeps the original
   if it reached storage. The file was still given to the review.

### Storage

The client asks `/api/upload` for `acq/<reviewId>/<timestamp>-<file>` in the
`leases` bucket. That endpoint replaces every character outside
`[A-Za-z0-9._-]`, so the object lands at
`<uid>/acq_<reviewId>_<timestamp>-<file>` — one segment under the owner's id,
which is exactly what `/api/document-url`'s ownership check reads. **No change
to `/api/upload`'s bucket list, to `/api/document-url`, or to the storage
policies in migration 011.** What is stored on the row is a reference
(`bucket/path`), never a public URL (SEC-1).

`api/upload.js`'s type allow-list gained `txt` and `webp`: the acquisition
pickers have always accepted `.pdf,.txt` and `.pdf,.jpg,.jpeg,.png,.webp`, so a
file the user was invited to choose was refused by the endpoint that stores it.
Nothing noticed while acquisition uploaded nothing at all.

### Statuses, and what each means

| status | meaning |
|---|---|
| `pending` | the file arrived; nothing has been read from it yet |
| `success` | read — a lease whose text was kept, or an invoice whose fields came back |
| `partial` | a lease whose fields were read but whose text could not be kept |
| `failed` | extraction failed; `error_message` says why, and the original is kept if it reached storage |

A scanned lease takes the vision path, which returns fields and not text, so a
second transcription pass runs alongside it — the same thing Lease Intake and
the amendment path already do, for the same reason: a scanned document must
still be readable later.

### When the original cannot be stored

Files above the upload limit are still read; the row keeps `storage_path` null
and the panel says **"Original not on file"** rather than offering a control
that opens nothing. The row carries the reason. Raising that limit needs
chunked or direct-to-storage upload, which is not this increment (D-11).

### When migration 023 has not been run

PostgREST reports the absent relation as `42P01`, which
`AcquisitionDocuments.isMissingTable` recognises on both the read and the write.
Uploads still extract — the workflow is not held hostage — and the panel says
documents are **not being filed**, naming `migrations/023_acquisition_documents.sql`,
so a review never looks as though it simply has none.

The file named is the file that is actually missing: `migrationFor()` maps the
table to its migration, because the reviews list can meet the same error and
`006_acquisition_reviews.sql` is what an operator would need then. Mutation
testing found that exact confusion in the endpoint before it was removed.

### No delete

There is none, by design: preserving every source is the increment. The data
layer has no remove path and the panel has no control for one. A removal would
be an explicit archive workflow with its own column and its own approval
(ARCHITECTURE_PRINCIPLES §4).

---

## 4c. P1-3 — what each source is, and what it belongs to (shipped)

P1-2 kept every file. P1-3 turns the flat list into
**Review → Document → Type → Family → Relationship**, and the whole increment
turns on those being *proposals* until a person confirms them.

### The smallest architecture that carries it

Classification is one-per-document, so it is **columns on
`acquisition_documents`** rather than a join table for a 1:1 relationship. A
family is an entity that gets renamed, merged and abstracted per-family in
P1-4, and two families can legitimately share a tenant name — so it is a
**table**, `acquisition_document_families`, with documents pointing at it.
Ordering inside a family is **derived, not stored**: tier then date, by the
function that already exists.

Migration 024 adds all of it. Nothing about P1-2's storage flow changed, and no
serverless function was added — `document_classification` joins the existing
`/api/claude` task registry, and both tables are written from the browser under
RLS the way P1-2 established.

### The vocabulary is LeaseIntelligence's

`original_lease · amendment · renewal · extension · assignment · guaranty ·
side_letter · snda · estoppel` belong to a leasehold; `psa · rent_roll ·
financial_statement · invoice · other · unknown` belong to the review.

The first four names and their tiers are **exactly**
`LeaseIntelligence.DOC_TYPE_TIER` (`side_letter 4, estoppel 3, amendment 2,
original_lease 1`), so P1-4 feeds `reasonMultiDocumentLease` rather than a
second reasoner written to match a new table. `renewal`, `extension`,
`assignment` and `guaranty` join amendment at tier 2 — they modify a lease the
same way. The tier lives in code, not in a constraint, because it is a reading
rule and a constraint would have to be migrated to change it.

### A proposal is never a fact

| what | who may say it | recorded as |
|---|---|---|
| a model's reading | `/api/claude` `document_classification` | `proposed`, with its confidence and the quote that decided it |
| a person's agreement | the Confirm control | `confirmed`, with `confirmed_by` |
| a person's correction | the type control | `corrected`, with `confirmed_by`, and the reading it replaced is kept |
| the lane a file came through | the invoice picker | `proposed`, source `intake_kind` |

Migration 024's trigger **refuses** a confirmed status with no `confirmed_by`,
and `buildPayload` refuses it too, so a broken caller is a named error rather
than a 500. `classification_history` keeps every act, appended and bounded, and
it is in the list's column set — a trail that is written but never read back is
truncated to whatever happened last, which is not an audit record.

### What it declines to decide

The failure this increment exists to avoid is a plausible guess stored as fact,
so `proposeFamily` and `proposeRelationship` mostly say no:

- an **amendment whose tenant has no lease on file** is classified and left
  unfiled — what it amends is not known;
- **two families naming one tenant** proposes neither;
- a **family with two leases** proposes no parent;
- a document the model cannot read stays `unknown` and stays visible;
- only an **original lease** may begin a family.

Tenant matching normalises case, punctuation and company form (`Coastal
Outfitters, L.L.C.` is `Coastal Outfitters Inc.`) and nothing beyond that.
There is no fuzzy or substring matching: anything further is a difference, and
differences are for people.

### Families

A family is **one leasehold** — a space and the chain of documents governing
it. An assignment stays in the family when the tenant changes, because what the
family tracks is the leasehold and not the counterparty. Non-lease documents
get no family in P1-3; `family_kind` exists so grouping financials later needs
no migration.

### D-14 — the same file name, uploaded twice

023 keyed a document on `(review_id, file_name)`, so a re-upload **replaced**
the row and that source left the record. Object storage was never the problem:
`/api/upload` names objects `acq_<review>_<timestamp>-<file>`, so both files
were always kept — only the row pointing at the older one was overwritten.

A document's identity is now **`intake_id`**, minted once when a file is taken
in and reused by that upload's second write, with `unique (review_id,
intake_id)` as the upsert's conflict key. One upload is one row; two uploads
are two rows even when they share a name. The older row is marked
`superseded_by_document_id` and keeps its own object, text and classification,
and the panel still shows it, still openable, marked replaced.

Supersession is deliberately **not** a value of `relationship`: that column is
for what a document does to another in law, and folding a stale upload into it
would make it read as a governing-document link. There is no version number —
order is tier and date, and amendments do not obey a total order. P1-4 gets the
current set from one predicate, `superseded_by_document_id is null`.

### The panel

The same panel, in three groups: **Needs review** first (unclassified, unfiled,
or a lease document with no lease to belong to), then one group per leasehold
with its documents in governing order, then the review's own documents. Each
row says what the document is, how settled that is, and what it changes —
named by the document it changes rather than by an id.

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

P1-2:

- `test-acquisition-documents.js` — drives `acquisition-documents.js` for real:
  `user_id` comes from the session and never from the fields offered, an id or an
  unknown key is dropped, an out-of-list status or kind is normalised, a
  nameless document is refused, the list does not ask for the text, the conflict
  key is `(review_id, file_name)`, and a missing table is recognised and names
  the migration for the table that is actually absent. It also checks the
  endpoint is **gone** and `api/` holds no more than 12 deployable functions,
  and pins the data layer: both halves go through the authenticated client, the
  read is scoped to the review and the signed-in user and ordered oldest first,
  and neither half asks for the document text. Plus the source-pinned intake
  checks — the row is written before extraction, a failure leaves a row, the
  stored value is a reference, the panel offers an opener.
- `test-e2e-acquisition-documents.js` — the walk, against a Supabase stand-in
  that enforces what the database enforces (the owner policy, the composite
  foreign key, the unique key, and a projection to the columns the query asked
  for) and an `/api/upload` stand-in that flattens the object name exactly as
  the real endpoint does: the row is visible while the extraction is still
  running, three files leave three rows with the failure's reason on screen, the
  original is addressed under the owner's id, re-opening the review reads them
  back, an oversize file says its original is not on file, **a document on
  someone else's review is refused by the database**, no serverless function is
  called at any point, and with the table absent the panel says documents are
  not being filed while extraction continues.
- `tools/verify-migration-023.js` — **executes** the migration against a
  throwaway PostgreSQL cluster (no Supabase project is contacted): it applies,
  re-applies unchanged, enforces RLS with no anon policy, isolates one user's
  documents from another's, refuses a document whose owner is not its review's
  owner, cascades on review deletion, rejects a duplicate file name and
  out-of-list values, moves `updated_at` on update, and rolls back cleanly —
  after which it applies again.
- `tools/acquisition-documents-mutation.js` — 32 mutants across the write
  contract, the data layer, the intake and the migration SQL itself.
- `test-security.js` gains the acquisition Documents panel as a
  document-bearing surface (§9), rendered through the real renderer.

P1-3:

- `test-acquisition-classification.js` — drives the model for real: the tiers
  match `lease-intelligence.js`'s own table (asserted against that file, not
  against a copy of it), an unrecognised type becomes `unknown` rather than
  something plausible, a null confidence is not stored as zero confidence, and
  every branch of `proposeFamily` / `proposeRelationship` that should decline
  does. Plus the confirmation guard, the audit trail, supersession, the
  grouping, and source-pinned checks that AI never writes a confirmation and
  nothing deletes a source.
- `test-e2e-acquisition-classification.js` — the walk, against a Supabase
  stand-in that enforces what migration 024 enforces (the owner policy, the
  composite keys, the coherence trigger, the `confirmed_by` rule and the
  column defaults): a lease begins its leasehold, an amendment joins it and
  names what it amends, an amendment with no lease on file is **not placed**, a
  rent roll gets no family, an unreadable scan stays unknown, confirming
  records the person, correcting keeps the reading it replaced, and a
  re-upload of a used file name leaves **both** sources on file with the older
  one still openable.
- `tools/verify-migration-024.js` — **executes** migration 024 against a
  throwaway PostgreSQL cluster on top of 000 + 006 + 023: it applies and
  re-applies, backfills `intake_id` for rows that already existed, swaps the
  identity, keeps both sources when a file name repeats, refuses a confirmation
  with no confirmer, refuses every cross-owner pointer, unfiles a document
  whose family is deleted rather than deleting it, and rolls back — **refusing
  to restore 023's unique key while doing so would mean destroying a preserved
  source**, which is the one case that cannot be undone cleanly.
- `tools/acquisition-classification-mutation.js` — 33 mutants across the model,
  the data layer, the migration SQL and the classifier's prompt.
- Every suite above is registered in `test-regression.js`.

---

## 6. Open decisions (recorded, not invented)

Each belongs to the increment that needs it; none is decided here.

| # | Decision | Needed by |
|---|---|---|
| D-2 | **The 13 columns of the lease matrix.** Today's Rent Roll tab shows 8 (Tenant · Suite · Sq Ft · Lease Term · Base Rent/yr · Renewal · Deposit · CAM Structure). The 13 must be supplied. | P1-8 |
| ~~D-3~~ | **RESOLVED** — acquisition documents live in their own `acquisition_documents` table (migration 023), isolated from `lease_documents`. The object store is shared (the existing private `leases` bucket, `acq_<reviewId>_` naming), so no bucket or storage policy changed. | P1-2 · done |
| D-4 | **Team activity / multi-user.** `acquisition_reviews` RLS is owner-only; team access is named in the IA and not implemented. P1-1 records activity for the owner. Sharing and roles are out of scope unless authorized. | later |
| D-5 | **Lifecycle representation.** Done in P1-1 as `data.stage` in jsonb; the `status` column and its constraint are unchanged so Command Center and portfolio actions keep working. Whether `status` should grow is not proposed. | — |
| D-6 | **Obligations and options extraction.** The current contract extracts only `renewal_options` and a boolean `audit_rights`. Adding fields to `lease_extraction` is a shared-contract change under the one-revision-one-re-extraction rule; recommended instead: a separate `acquisition_abstraction` task. | P1-4 |
| D-7 | **Financial intake formats.** Which rent roll / GL sources (Yardi, MRI, Excel, scanned PDF)? Sample files decide the parser. | P1-5 |
| D-8 | **Stabilized / underwritten figures.** Assumed user-entered in-app; not imported from a model. | P1-7 |
| D-9 | **Q&A scope.** Single document, or one family's governing documents? Cross-family questions stay a refusal (ARCHITECTURE_PRINCIPLES §1). | P1-9 |
| D-10 | **Page numbers on extraction evidence.** Extraction quotes carry no page today; capturing one is a contract change. | P1-4 |
| D-11 | **Large scans vs "preserve sources".** Still open. Originals over the upload limit are read, and the row now says the original is not on file with its reason — honest, but the source is still not kept. Raising it needs chunked or direct-to-storage upload. | a later increment |
| D-12 | **Stage gating and auto-advance.** Which stage requires what, and whether any act (analysis run, documents added) should move the stage. P1-1 keeps the stage a manual marker. | P1-6 |
| D-13 | **Existing Pilot reviews.** They upgrade in memory on load and on disk with their next change. Reading their count or shape means touching the Pilot database, which needs authorization. | open |
| ~~D-14~~ | **RESOLVED** — a document's identity is `intake_id`, minted once per upload, and the upsert keys on `(review_id, intake_id)`. A second upload of a used file name is its own row; the earlier one is marked `superseded_by_document_id` and keeps its object, its text and its classification. Object storage never lost anything — only the row pointing at it did. Supersession is its own column, not a `relationship` value, and there is no version number. | P1-3 · done |
| ~~D-15~~ | **RESOLVED** — `review.data.documents[]` stays as a vestigial empty array and is never written to; `acquisition_documents` is the one home. Removing the key would contradict `upgradeReview`'s first rule (an upgrade never removes a key), so it is left and documented instead. | P1-3 · done |
| D-16 | **Confirming a whole family at once.** P1-3 confirms a document at a time, which is right for a handful and tedious for a data room. Whether a family-level "confirm all" is wanted, and whether it should record one act or one per document, is undecided. | P1-4 or later |
| D-17 | **Moving a document between families, and merging two.** P1-3 can unfile a document by correcting its type, but has no control for "this belongs to that other leasehold" or "these two families are one". The table supports both; the workflow is not designed. Related and also open: correcting a lease to a review-level type leaves the amendments that named it as their parent still pointing at it — a proposal that is visible and wrong rather than hidden, but nothing re-proposes them. | P1-4 |
