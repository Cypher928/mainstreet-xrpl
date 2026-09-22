# Acquisition Review — Phase 1

**Status:** in progress on `pilot`. Increments **P1-1, P1-2 and P1-3 are
shipped**, with migrations 023 and 024 applied to the Pilot project. **P1-4 is
in progress under the approved plan in §4d. Increment P4-1 is CLOSED — built,
validated locally, migration 025 applied to Pilot, deployed to
www.mainstreet-review.com and validated in the live browser on a real lease
(§4e, §4f). Increment P4-2 is CLOSED — the term resolver, shipped
to `pilot` and verified against the owner-operator CAM path (§4g). Increment
P4-3 is BUILT and awaiting review (§4h): the append-only decision history, the
four human acts and the Lease Terms panel. Migration 026 is APPLIED to the
Pilot project and verified in place; the P4-3 code is committed as `edc1de9`
and NOT yet pushed.**
P4-V does not start until P4-3 is reviewed. Production (`main`,
mainstreetcam.com, the production Supabase project) is not touched by this
work.

§7 records feedback from the acquisition team that binds P1-5 and P1-7. It is a
requirement, not a change: no code has been written against it.

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
| P1-4 | **Lease Intelligence** — approved plan in §4d: 27 fields, per-document evidence, the existing reasoner reused with an optional field list, five term states with the classification ceiling, per-field append-only decisions, no write-back | **P4-1 and P4-2 shipped (§4f, §4g); P4-3 built, awaiting review (§4h); P4-V not started** |
| P1-5 | Financial Intake — **the GL is the primary financial source; seller invoices are optional** (§7) — rent roll and GL, contractual vs rent roll vs GL side by side, sources kept | planned |
| P1-6 | Needs Attention — ranked, evidence-pointed, gates completion; **missing information is reported as missing, never as none** (§7) | planned |
| P1-7 | Acquisition Report v2 — **the five buyer questions** (§7); verified vs assumption vs issue vs missing. **Replaces the CAM-recovery framing of today's Decision Report** | planned |
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

## 4d. P1-4 — Lease Intelligence (approved plan; increments ship one at a time)

**Status: plan approved. P4-1 shipped and validated on the live Pilot — see
§4e and §4f. P4-2, P4-3 and P4-V do not start until the preceding increment
has been validated and reviewed.**

### The one job

Turn a family of classified documents into ONE set of lease terms, each
carrying the document and clause behind it, and each saying how settled it is.
P1-3 made the documents addressable, typed, grouped and ordered. P1-4 reads
them.

### Rules that bind every increment of P1-4 (approved)

- **Document classification status matters to term status.** A term derived
  from an `unclassified` or `proposed` classification cannot become
  `verified`, even with a value and a quote. The term's status is the WEAKER
  of the supporting evidence and the classification.
- **Confirm and Correct on a term are BLOCKED** while the governing document's
  classification is `unclassified` or `proposed`. The person confirms or
  corrects the document's classification first. The UI says so, rather than
  silently accepting a confirmation and capping it.
- **`missing` means the documents do not establish the term.** It is never
  `none`, `no` or `0`. An explicit negative in a document — "Tenant shall have
  no option to renew" — is an extracted VALUE with a quote, and is not missing.
  Nothing may turn an unknown into a negative or a zero.
- **Contradictions stay visible.** They are never auto-resolved; a person
  chooses.
- **Governing terms are derived by the existing
  `LeaseIntelligence.reasonMultiDocumentLease`.** No second reasoner. The
  acquisition field list is passed as an optional second argument; the
  owner-operator path is unchanged and a test proves it.
- **AI proposes; a human confirms or corrects. AI never writes verified truth.**
- **No write-back.** P1-4 does not populate `review.data.tenants[]` and does
  not feed today's CAM-framed Decision Report. P1-7 consumes the acquisition
  model when Report v2 is rebuilt around the buyer's questions.
- **Confirmation is per field**, never per family. Confirming `lease_type`
  says nothing about `cap`.
- **The shared `lease_extraction` contract is untouched.** Abstraction reads the
  text P1-2 preserved.
- **Page numbers are nullable metadata.** Evidence is always the document plus
  the quote; a page is stored only when the abstraction task can genuinely tie
  the quote to one, never invented.
- **No new serverless function. Pilot only.**

### 1. The fields (27), approved exactly as listed

| group | fields | standing |
|---|---|---|
| **A** — the reasoner's canonical 13 | `cap` `cap_base_amount` `admin_fee_pct` `gross_up_pct` `expense_stop` `audit_rights` `pro_rata_method` `renewal_options` `tenant_name` `leased_sqft` `start_date` `end_date` `lease_type` | source of truth; names unchanged |
| **B** — extracted today, never governed | `base_rent` `security_deposit` `suite` `excluded_categories` `admin_fee_basis` | already in `lease_extraction`; `CANONICAL_FIELDS` omits them, so no document ever governs them across a family |
| **C** — genuinely new, one per committed category | `tenant_improvement_allowance` `landlord_work` `guarantor_name` `guaranty_limit` `termination_rights` `expansion_rights` `assignment_consent` `exclusive_use` `co_tenancy` | allowances · landlord work · guaranties (×2) · options (×2) · obligations (×3). **Keep all nine; do not reduce, rename or defer.** |

The guaranty *document* was already representable (`doc_type: 'guaranty'`);
who the guarantor is and what the cap is were not. That is why those two
fields exist.

### 2. Per-document evidence — `acquisition_documents.abstracted_fields`

```
{
  "schemaVersion": 1,
  "model": "…",
  "at": "ISO-8601",
  "fields": {
    "<field>": { "value": …|null, "quote": "…"|null, "page": n|null, "confidence": 0..1|null }
  }
}
```

Every field the task was asked for appears. `value: null, quote: null` means
this document does not establish the term — different from never having
looked. A value with no quote can never reach `verified`. Alongside it:
`abstraction_status` ∈ `pending · success · partial · failed · skipped`,
`abstraction_model`, `abstracted_at`. `skipped` is the honest state for a
document that is not a lease-family document; a rent roll is not abstracted.

### 3. Human decisions — `acquisition_term_decisions`, append-only

One row per human act, per field, per family: `id` `review_id` `user_id`
`family_id` `field_key` `action` ∈ `confirm · correct · reject · reopen`
`previous_value` `new_value` `source_document_id` `source_quote` `source_page`
`decided_by` (not null) `decided_at` `note` `created_at`. The current decision
is the latest row by `decided_at`. A trigger REFUSES update and delete, so the
correction history cannot be rewritten. Composite keys on `user_id` to reviews,
families and documents; owner-only RLS; no anon policy.

### 4. Migrations

Split so each increment is validated against exactly its own schema change:

- **025 (P4-1)** — `abstracted_fields`, `abstraction_status`,
  `abstraction_model`, `abstracted_at` on `acquisition_documents`.
- **026 (P4-3)** — `acquisition_term_decisions`, and the extension of
  `acq_docs_relationship_status_check` to admit `needs_review` (§9 below).

Each Pilot-only, with a rollback and a `tools/verify-migration-0NN.js` that
executes it against a throwaway cluster before it is applied.

### 5. Wrapping the reasoner (P4-2) — `acquisition-terms.js`

`buildReasonerInput(documents)` maps the family's CURRENT documents
(`superseded_by_document_id is null`) into the shape the reasoner already
takes: `docType` ← `doc_type`, `docDate` ← `doc_date`, `extractedFields` and
`quotes` ← `abstracted_fields`. It calls
`LeaseIntelligence.reasonMultiDocumentLease(docs, { fields })`. The ONLY change
to `lease-intelligence.js` is that optional second argument, defaulting to
`CANONICAL_FIELDS`. `resolveTerms(reasonerResult, documents, decisions)` then
applies the state model, the ceiling, and the decision overlay.

### 6. The five-state term model

| state | reached when |
|---|---|
| `verified` | a human confirmed it; the governing document has a quote; that document's classification is `confirmed` or `corrected` |
| `ai_extracted` | a value with evidence that nobody has confirmed, or the ceiling (§8) caps it here |
| `conflicting` | the reasoner returned contradictions and no human has chosen |
| `unclear` | a value with no supporting quote, or a quote that does not support the value |
| `missing` | no current document in the family establishes the term |

For P1-7 these project onto §7's four: `conflicting` and `unclear` → **issue**;
`ai_extracted` → **assumption**; the other two carry across.

### 7. Contradictions and missing, on screen

A contradiction shows BOTH values with the documents that assert them, at
`conflicting`, until a person chooses. A missing term is a row that reads "no
document on file establishes this" — never zero, never blank, never omitted.

### 8. Classification status → term status (the ceiling)

| governing document's `doc_type_status` | highest term state reachable |
|---|---|
| `unclassified` or `proposed` | `ai_extracted` — and Confirm/Correct are disabled, with the reason shown |
| `confirmed` or `corrected`, quote present | `verified`, once a human confirms the term |
| `confirmed` or `corrected`, no quote | `unclear` |

### 9. D-17 — relationships stay coherent (P4-3)

Reclassifying a document from a lease-family type to a review-level type
clears its family (as today) but no longer discards its relationship:
`parent_document_id` and `relationship` are preserved and
`relationship_status` becomes `needs_review`. The same happens in reverse when
a document's parent is reclassified away. Nothing is auto-reassigned. The
prior state is appended to `classification_history`; P1-6 surfaces these.

### 10. Browser UX (P4-3)

A Lease Terms panel per family under the Documents panel: field, governing
value, state chip, source document and clause snippet, Confirm / Correct.
Superseded values collapse. Conflicting fields show both values and both
documents. Missing fields are listed, not hidden. Tested at 375, 390 and 430
pixels from the first commit.

### 11. Increments and verification

| # | ships | validated by |
|---|---|---|
| **P4-1** | `acquisition_abstraction` task on the existing `/api/claude`; the 27-field evidence shape; migration 025; abstraction at intake for lease-family documents; `skipped` for the rest; re-abstraction when a document is corrected into a lease-family type | pure contract suite, browser walk, migration executed, mutation, security task registration, regression baseline |
| **P4-2** | `acquisition-terms.js` resolver; the optional field list on the reasoner; five states; ceiling; contradictions; missing-vs-negative | pure suite incl. proof the owner-operator reasoner is unchanged; mutation on state transitions, ceiling, conflicts, missing-vs-negative |
| **P4-3** | migration 026; decisions table; Lease Terms panel; blocked Confirm with reason; D-17 `needs_review` | browser walk incl. narrow viewports; migration executed incl. append-only refusal and cross-owner refusal; mutation |
| **P4-V** | — | full regression against the established baseline |

---

## 4e. P4-1 — what each document says (shipped)

**Status: shipped to Pilot and validated in the live browser (§4f).**
Everything below is what the increment does; §5 lists what proves it and §4f
records the live validation. Nothing in P4-2 or P4-3 has been started.

### What it adds

- **`acquisition-terms.js`** — the vocabulary and the evidence shape, pure.
  `FIELD_GROUPS` holds the 27 fields of §4d.1 in their three groups; group A
  is `LeaseIntelligence.CANONICAL_FIELDS` byte for byte and a test asserts it
  against that file. `FIELD_META` says what each field IS (number · money ·
  percent · date · boolean · enum · text, with the enum vocabularies taken
  from `lease_extraction`). `normalizeFieldValue`, `normalizeEntry` and
  `buildAbstraction` turn a model reading into the §4d.2 shape — every field
  present, unknown keys dropped, quote bounded to 600, page a positive integer
  or null, confidence 0..1 or null — and `summarizeAbstraction` counts it.
  `isAbstractable(docType)` is the lease-family predicate and gives the same
  answer as `AcquisitionDocuments.isFamilyType` for every type.
- **`acquisition_abstraction`** in `api/_claude-tasks.js` — the server-owned
  task on the existing `/api/claude`. It names all 27 fields, each once, with
  its type; instructs that a term the document does not address is
  `{ value: null, quote: null }`; that an explicit denial or waiver is a VALUE
  with its clause; that quotes are verbatim and at most 600 characters; that a
  page is reported only from a `--- Page N ---` marker and never guessed; and
  that nothing is inferred from the file name. The untrusted-document boundary
  applies. Ceiling 6000 tokens, above the worst case of 27 quoted fields — a
  truncated reply is unparseable and loses the whole reading.
- **Migration 025** — four columns on `acquisition_documents`:
  `abstracted_fields jsonb not null default '{}'`, `abstraction_status text
  not null default 'pending'`, `abstraction_model`, `abstracted_at`. Three
  checks: the evidence is an object; the status is one of the five; **a
  status of `success` or `partial` must carry a `fields` key and a
  timestamp**. One partial index on `(family_id, abstraction_status)` for the
  reads P4-2 makes. No new table, no new policy — the owner policy covers the
  new column. Rollback removes exactly those objects.
- **The document model** — `WRITABLE`/`CAMEL` gain the four columns; the list
  select gains `abstraction_status`, `abstraction_model`, `abstracted_at` and
  deliberately **not** `abstracted_fields` (27 quoted entries per row is
  `extracted_text`'s problem again). `buildPayload` refuses `success` /
  `partial` without fields and timestamp before the database gets to.
  `migrationForError` is now column-aware: a missing 025 column names 025, a
  missing 024 column still names 024.
- **The data layer** — `_acqAbstractDocument(reviewId, docRow, text)` runs at
  intake **after the source is stored and after it is classified**, because
  whether a document is read depends on what it is: a lease-family type is
  read for its terms; anything else (rent roll, invoice, unclassified) is
  `skipped`; no stored text or a failed call is `failed`. A failure keeps the
  evidence the row already had. The four columns are written together in one
  upsert, from `buildAbstraction` and nothing else. The text is sent whole
  (up to 120k characters) with the file name and the classified type as
  context only.
- **Corrections** — `acqSetDocType` re-reads a document corrected **into** a
  lease-family type, from its stored text via `_acqLoadDocumentText` (one row,
  owner-scoped), and marks one corrected **out** as `skipped`, leaving its
  evidence in place. A correction between two lease-family types does not
  re-read: the terms are the same words.
- **The panel** — one chip per lease-family document row: *Terms read* ·
  *Terms read — none established* · *Terms could not be read* · *Terms not
  read yet* · *Reading terms…*. A rent roll shows nothing; it has no terms. A
  lease-family document not yet read (including every Pilot document that
  predates 025) offers **Read terms**, which reads from the stored text. The
  row's phone layout is measured with the chip and control present.

### What it does NOT do

- It does not resolve a governing value, apply the ceiling, or show a term.
  That is P4-2 and P4-3.
- It does not touch `lease-intelligence.js`. `reasonMultiDocumentLease` still
  takes one argument; a test proves the owner-operator result is what it was
  and that the reasoner knows nothing of the nine new fields.
- It does not write back. The tenant `lease_extraction` produced is what it
  returned; the review record holds no abstraction; the browser walk checks
  both.
- It does not add a function. `api/` still holds twelve.

### Deploy protocol

The list select now names the 025 columns, so on a Pilot database without 025
the Documents panel says documents are being read but not filed and names
`migrations/025_acquisition_abstraction.sql`. Therefore: review → authorize
025 → apply to Pilot → push → verify. **025 was applied to Pilot on
2026-09-21** (Supabase migration `20260921201418_025_acquisition_abstraction`):
four columns with their defaults, three checks, the partial index, both
column comments; the three existing documents came out `pending` with `{}`
and their identity, text, classification and history fingerprint unchanged;
a probe confirmed every refusal (empty evidence under `success`, no
timestamp, a status outside the list, an array as evidence, and 024's
unconfirmed confirmation) and rolled itself back. The code was then pushed to
`pilot` and deployed; §4f records the live validation.

---

## 4f. P4-1 closeout — validated on the live Pilot

**Deployed commit `f302e88`** (which carries `7fbe696`), Vercel deployment
`dpl_BD2r7Zjn3SqNsbwnUqDyfZYKiq3F`, state READY, aliased to
`www.mainstreet-review.com`. The alias was confirmed to serve the new build by
fetching `/acquisition-terms.js`, a file that does not exist before `7fbe696`.

### What was walked, in the live browser, on a phone

The operator ran it on **`ShopRite_Anchor_Tenant_Lease.pdf`**, a real 33-page
lease under the Maple plaza review with 107,041 characters of stored text,
uploaded before migration 024 and therefore `unclassified` and `pending` going
in. Observed on screen: the document read Unclassified / Not Confirmed; the
type was corrected to a lease-family type; the row showed **"Reading terms…"**
and then **"Terms read"**; after a full page refresh the row still read
Renewal and Terms read; "Open original" still opened the 33-page original; the
other two documents were untouched and still unclassified; the mobile layout
held.

### What the database showed afterwards

The UI was not taken at its word. The row was read back directly:

| column | value |
|---|---|
| `abstraction_status` | `success` |
| `abstraction_model` | `claude-sonnet-4-6` |
| `abstracted_at` | 2026-09-21 20:30:55.85+00 |
| `abstracted_fields` | `schemaVersion` 1, **27 fields**, 10 valued, 10 evidenced, 0 quote-only, 17 missing |

All four columns are genuinely populated, the field count is exactly the 27 of
§4d.1, and `success` is correct because at least one field carries a value
WITH its quote. Representative evidence, verbatim from the row:

- `cap` = 4 — *"CAM increases are capped at 4% annually, excluding
  uncontrollable expenses."*, page 4, confidence 0.95
- `leased_sqft` = 65000 — *"Leased Area: 65,000 rentable square feet"*, page 1,
  confidence 0.99
- `lease_type` = `NNN`, `start_date` = 2024-03-01, `end_date` = 2039-02-28,
  `tenant_name` = "ShopRite Supermarkets, Inc.", each with its own clause and
  page.

**Missing stayed missing.** Seventeen fields came back `value: null,
quote: null` — among them `audit_rights`, `guarantor_name`, `co_tenancy`,
`tenant_improvement_allowance`, `expense_stop`, `pro_rata_method`. None was
stored as 0, `false` or `""`. Ten valued plus seventeen missing is twenty-seven.

### Two behaviours worth recording, because they look wrong and are not

**`abstracted_at` precedes `confirmed_at` by six seconds.** The history shows
two human corrections: `null` → `amendment` at 20:30:35.682, then `amendment` →
`renewal` at 20:31:02.006. The abstraction ran on the FIRST correction, the one
that moved the document into a lease family, and finished at 20:30:55.85. The
second correction did not re-read, because a correction between two
lease-family types is the same document saying the same words — that is the
designed behaviour in `acqSetDocType`, and the timestamps are its fingerprint.
`confirmed_at` tracks the latest classification act; `abstracted_at` tracks the
reading. They are not meant to agree.

**`renewal_options` came back weak, and said so.** Its value is the term
sentence rather than the option schedule, with **confidence 0.4** — by far the
lowest of the ten. The low confidence is the mechanism working: P4-2's state
model and a human confirmation are what resolve a reading like this, and
nothing in P4-1 presents it as settled.

### One reading to watch

`base_rent` was stored as **1202500** against the quote *"Tenant agrees to pay
base rent of $18.50 per square foot annually."* That is 65,000 × $18.50: the
clause states a RATE and the stored value is a computed annual total. The task
does ask for "annual base rent in dollars", so this is within its instruction,
but the quote does not literally contain the number it supports. `base_rent` is
group B — extracted, never governed across a family — so nothing downstream
relies on it today. **Flagged for P4-2** as the first candidate for the
`unclear` state, where a value its quote does not literally establish is shown
as such rather than as evidenced.

### Not exercised live

Two cases in the approved plan had no real data to exercise them, and the
corpus could not provide one:

- **An explicit negative** ("Tenant shall have no option to renew"), which must
  be stored as a VALUE with its quote. Zero of the 27 fields came back as a
  quoted zero or a quoted `false`. Covered by `test-acquisition-terms.js`,
  `test-e2e-acquisition-abstraction.js` and `tools/verify-migration-025.js`, but
  **not by a real document**.
- **A failed abstraction on a document with no usable text.** No live failure
  occurred. Covered by the suites only.

Both remain live-unverified and should be watched for the first time a real
document produces one.

### Untouched, and confirmed untouched

`SafeShield_Insurance_Lease.pdf` and `Prime_Wellness_Spa_Lease.pdf` both still
read `doc_type` NULL, `unclassified`, `abstraction_status` `pending`,
`abstracted_fields` `{}`, no model, no timestamp, and an empty
`classification_history`. Nothing collateral was written. A pre-025 document
that nobody has classified shows no terms chip and no Read terms control,
because `isAbstractable(null)` is false — honest silence rather than a promise.

---

## 4g. P4-2 — the term resolver (shipped)

**Status: shipped to `pilot` as `5cc8cd1` and deployed. Headless by design — no
UI, no migration, no schema change, nothing a person can see. After deployment
the owner-operator CAM path was re-verified: twenty of twenty-one
lease-intelligence and CAM suites passed, and the one failure
(`test-e2e-property-mismatch.js`) fails identically on the commit before P4-2,
because it needs live network and a sign-in this session cannot reach. The
Lease Terms panel and the decisions table are P4-3 (§4h).**

### The one change to `lease-intelligence.js`, and nothing else

`reasonMultiDocumentLease(documents, options)` gained an optional second
argument. `options.fields` replaces `CANONICAL_FIELDS` for the loop; omit it,
pass `{}`, pass `{ fields: [] }` or pass nonsense and the function behaves
exactly as it did. The precedence rules themselves are untouched, because they
were never about which field was being governed — they are about which
DOCUMENT governs. `DOC_TYPE_TIER` is **not** widened: doing so would change
every existing owner-operator lease.

### Nine types onto four tiers

The reasoner knows `original_lease · amendment · estoppel · side_letter`.
Acquisition Review has nine lease-family types, and P1-3 gave them tiers
chosen to match that table. `REASONER_DOC_TYPE` maps each of ours onto the
reasoner type that **shares its tier**: renewal, extension, assignment and
guaranty rank as an amendment does; an SNDA ranks as an estoppel does. A test
reads both tables and asserts the mapping preserves every tier, so a renewal
outranks the lease it renews.

### What feeds the reasoner

`buildReasonerInput(documents)` admits a document only if it is **current**
(not superseded, D-14), a **lease-family type**, and actually **read**
(`abstraction_status` `success` or `partial`). A rent roll, an unclassified
scan, a failed read and a replaced upload all have nothing to say about lease
terms, and saying nothing is the correct contribution. A field's value is
offered only when it is non-null; its quote is offered either way, so a clause
nobody could read a value from survives into the answer as `unclear` rather
than vanishing.

### Does the clause actually say it — `evidenceSupport`

The live P4-1 run produced the case this exists for. `base_rent` came back as
1,202,500 against *"Tenant agrees to pay base rent of $18.50 per square foot
annually."* That is 65,000 × $18.50: defensible arithmetic, and not something
the clause states. So each entry is classified:

| support | meaning |
|---|---|
| `stated` | the clause contains the value |
| `derived` | a number the clause does not contain — computed, or wrong |
| `none` | there is no quote, or no value |

The value is **kept**, the arithmetic is **not undone**, the clause is kept
with it, and the term is `unclear` with `derived: true` and a sentence saying
the figure was worked out rather than read. A human correction clears the flag,
because then a person has vouched for it.

Commas, currency symbols and accounting parentheses are understood, so
"65,000 rentable square feet" states 65000 and "(500)" states -500 — the same
notation `normalizeFieldValue` already reads. **An explicit negative is
recognised before the numeral check can call it derived**: "There shall be no
cap" states 0.

**Stated limit:** only numbers are checked this way. A date, an enum, a boolean
and free text cannot be compared to their clause by containment without a
parser per type, and a false `derived` would be worse than no check. For those,
a quote is taken at its word.

### The five states

| state | reached when |
|---|---|
| `verified` | a person confirmed or corrected it AND the ceiling allows it |
| `ai_extracted` | a value with a clause that states it, nobody having confirmed |
| `conflicting` | same-rank documents disagree and no person has chosen |
| `unclear` | no clause, a clause with no readable value, or a derived figure |
| `missing` | no current document establishes the term |

All 27 come back every time. `missing` says *"No current document on file
establishes this term"* in words — never zero, never blank, never omitted.

### The ceiling

| governing document's `doc_type_status` | highest state | Confirm |
|---|---|---|
| `unclassified` or `proposed` | `ai_extracted` | blocked, with the reason |
| `confirmed` / `corrected`, clause present | `verified` | allowed |
| `confirmed` / `corrected`, no clause | `unclear` | allowed |

The ceiling follows the **governing** document, not the best-classified one in
the family. A contradiction and an absence are facts about the documents rather
than weak readings, so no ceiling turns either into agreement.

### Contradictions

Taken from the reasoner verbatim and never auto-resolved. Both values stay on
the term with the documents asserting them, and `history` lists every document
that spoke, strongest first. A human decision moves the state off
`conflicting`; **the contradiction record stays**.

### Lineage, and a cross-check

The reasoner returns the governing docTYPE but not which document it was, and
the ceiling needs that document's classification. So the resolver reproduces
the reasoner's ordering to name the governing row, and then **cross-checks**:
if the reasoner's `currentValue` disagrees with the document the resolver
identified, the term carries `lineageMismatch: true` rather than quietly
preferring one of the two. A field the reasoner was not asked about trips the
same flag, which is what keeps `options.fields` from being accepted and ignored.

### Decisions, read but not yet written

`resolveTerms` applies `acquisition_term_decisions` rows if given any. Until
P4-3 creates that table the list is always empty and nothing is ever `verified`
— AI does not write verified truth. The overlay: `confirm` verifies (subject to
the ceiling), `correct` replaces the value and records the person, `reject`
keeps what the document said and stops presenting it as the answer, `reopen`
returns the term to the documents. Latest by `decided_at` wins, array order is
irrelevant, and a decision on one field says nothing about any other.

---

## 4h. P4-3 — the human decisions and the Lease Terms panel (built; awaiting review)

**Status: built and validated locally; migration 026 APPLIED to the Pilot
project and verified in place (see "Applied to Pilot" below); the code is
committed as `edc1de9` and NOT yet pushed.** The Documents panel and the Lease
Terms panel both name 026's columns, so shipping the code first would degrade
them; the order is the same as P4-1's: review → authorize 026 → apply → push →
verify. The push is the remaining step.

### Applied to Pilot

**2026-09-22**, Supabase migration `20260922010643_026_acquisition_term_decisions`,
applied verbatim from `edc1de9`. Verified in place:

- 15 columns with the documented types, nullability and defaults; 9
  constraints including the three composite foreign keys with their
  `ON DELETE` column lists; 2 indexes beside the primary key; 3 triggers
  (actor, no-update, no-delete); RLS enabled with exactly two policies
  (owner and service_role) and **none for anon**.
- D-17: `acq_docs_relationship_status_check` now admits `needs_review`
  alongside `proposed` and `confirmed`. No document currently carries a
  relationship status, so nothing was re-validated into or out of the change.
- **Existing data untouched.** 10 reviews, 3 documents, 0 families before and
  after, and a fingerprint over every document's identity, text, classification,
  relationship, abstraction and history is **identical** either side of the
  migration. The decisions table came up empty, as it should.
- A behavioural probe on throwaway rows, rolled back in full, confirmed 24
  checks: every immutable field refuses a real change (action, field_key,
  previous_value, new_value, decided_by, decided_at, created_at, source_quote,
  source_page, note, review_id), a single delete and a blanket delete are both
  refused, the actor rule and the action and correction constraints hold on
  insert, **deleting a family clears the document's family reference and
  unfiles its decisions without the append-only guard blocking it**, and
  **deleting a review cascades its decisions away**. Nothing persisted: no
  probe rows remain and the document fingerprint is unchanged.
- `tools/verify-migration-026.js` on a throwaway cluster: **83 passed, 0 failed.**

One thing worth recording because it looks like a hole and is not. An UPDATE
that sets a column to the value it already holds is allowed, because the guard
compares values and a no-op changes nothing. The first probe hit this by
writing `decided_at = now()`, which inside one transaction equals the
insert-time value. Re-tested with `decided_at + interval '1 day'`, an explicit
literal, and a change to `created_at`, all three were refused and the stored
timestamp was verified unchanged. The guard is sound; the first probe was
measuring a no-op.

### `acquisition_term_decisions` — append-only, and why

A decision is an EVENT, not a property of a term. "Confirmed at 4%, then
corrected to 5%, then reopened" is three facts about three moments, and a
column keeps only the last. One row per human act, per field, per family, with
the approved shape: `field_key` `action` ∈ `confirm · correct · reject ·
reopen`, `previous_value` `new_value`, `source_document_id` `source_quote`
`source_page`, `decided_by` (not null) `decided_at` `note`. Owner-only RLS, no
anon policy, composite keys on `user_id` to reviews, families and documents.

**The AI evidence is never touched from here.** It stays in
`acquisition_documents.abstracted_fields` where 025 put it. A correction
records the new value beside the one it replaced; it does not reach into the
document. A rejection does not delete a reading. The resolver lays one record
over the other at read time.

### Append-only, corrected by execution

The first version of the trigger refused **every** UPDATE and DELETE. Running
it against a real cluster showed why that was wrong: the database performs its
own UPDATEs and DELETEs here. `on delete set null` clears `family_id` when a
family is deleted, and `on delete cascade` removes decisions when their review
is deleted. A blanket refusal made a family or a review **undeletable** for
ever once one decision existed.

The guarantee has to protect the decision, not forbid the statement. So:

- Everything that makes a decision a decision — action, values, citation,
  actor, timestamps — is immutable. Changing any of them is refused.
- The two nullable foreign keys may be cleared to NULL and never repointed,
  which is exactly what the cascades do.
- A DELETE is allowed only when the review itself is already gone, which is
  the cascade doing its work. Every other delete still has its review, and is
  refused.

### The four acts

| act | effect on the term | effect on the evidence |
|---|---|---|
| `confirm` | `verified`, subject to the ceiling | none |
| `correct` | value replaced, `verified`, previous value recorded | none |
| `reject` | `unclear`; the reading and clause are KEPT | none |
| `reopen` | back to what the documents say; no decision in force | none |

Latest by `decided_at` wins, array order is irrelevant, a reopen clears the
conclusion and not the history, and a decision on one field says nothing about
any other.

### The gate

Confirm and Correct are refused while the governing document's classification
is `unclassified` or `proposed`. Enforced in **two** places: `buildDecisionPayload`
returns the reason, so a disabled button is a courtesy rather than the
enforcement, and the panel disables the controls with that reason on the
control and in a row of its own. Reject and Reopen are deliberately NOT gated —
saying a reading is wrong does not require first agreeing what the document is.

### The panel

One section per leasehold under Documents. Each term shows its label, a state
chip for all five states, its value, the governing document with page and
confidence, the clause in quotation marks, and up to four controls. Beyond that:

- **Missing is a sentence**, "No document on file establishes this", never a
  blank or a zero, and it offers no Confirm or Correct because there is nothing
  to confirm.
- **A contradiction shows both values and both documents** and says nothing was
  chosen for you.
- **A derived figure says so**: "Calculated, not quoted: the clause gives a
  rate or a component, not this figure." The `base_rent` case from the live
  P4-1 run is exactly this.
- Superseded values and the decision in force each get their own line.
- The evidence column is fetched by itself (`id, abstracted_fields`) rather
  than being added to the documents list, which P4-1 deliberately kept lean.

### D-17

Reclassifying a document out of a lease-family type no longer discards its
parent and relationship. They are PRESERVED and `relationship_status` becomes
`needs_review`, appended to `classification_history` with its actor. A document
that amended a lease yesterday still amended it today, and throwing the link
away to keep two columns tidy destroys a fact nobody can recover. Migration 026
widens the check; `acqSetDocType` writes it.

---

## 4i. P4-3 remediation, Issue A — the reading that was thrown away

Found by the first live browser test of P4-3, on the Pilot, 2026-09-22.

### What happened

A lease amendment was uploaded to the Maple Plaza review. It parsed cleanly
(3,081 characters, readable), classified as `amendment` at confidence 0.95, and
the terms panel reported **"Terms could not be read."** The row said
`abstraction_status = 'failed'`, `abstracted_fields = {}`, no model, no
timestamp, and `error_message = null` — nothing to say which of the three code
paths that write `failed` had written it.

The server's own logs said something else. `/api/claude` had returned **HTTP
200** with valid 27-field evidence, including `cap: 3` with the clause behind it
at confidence 0.97. Grouped by status code over the window: four requests, all
200, zero errors.

The arithmetic tells the rest. The abstraction request began at `03:15:49.6`
(the client's own `classification_history.at`, corroborated by the server log).
The `failed` row was written at `03:16:51.139` — **61.5 seconds later**. The
only timeout in that path was `_fetchWithTimeout`'s 58,000 ms default.

The browser gave up at 58 seconds. `vercel.json` gives the function 60. A
correct answer arriving in the two-second gap was aborted by the client and
filed under a word that described none of it.

### The invariant that was inverted

```
        BEFORE                              AFTER
  client        58s   ← gives up       client        75s
  maxDuration   60s                    maxDuration   60s
  Anthropic   unbounded                Anthropic     45s   ← gives up
```

A ceiling must be *above* the ceiling of the thing it waits on. Then a client
abort implies the platform had already killed the function, so there was no
success to discard. The fix is that sentence, made true in three files.

**A1 — the server bounds itself.** `api/claude.js` wraps the Anthropic call in
an `AbortController` at 45s — the same constant, for the same reason and in the
same words, as `api/ask-lease.js` — and answers **504** with
`reason: 'upstream_timeout'` rather than folding a timeout into the generic 500.
The handler now always answers inside its budget.

**A2 — the client waits longer than the function may live.** `claudeFetch(body,
opts)` takes an optional `opts.timeoutMs`, exactly as `explainFetch` already
did. The 58s default is **unchanged**, so every existing caller is untouched;
`_acqAbstractDocument` alone passes 75,000. 58 was not nudged to 60: two seconds
is not a margin, and the suite pins at least ten.

**A3 — the work was made to fit.** The prompt asked the model to
`Report EVERY one of these 27 fields, each exactly once`, so an amendment that
changes four terms emitted twenty-three objects of nulls token by token — and
output tokens are where the wall-clock went. It now asks for the fields the
document **establishes** and to omit the rest.

The stored contract is unchanged, because it was never the model's to keep:
`buildAbstraction` walks `FIELDS` and normalises every absent key to
`{value:null, quote:null, page:null, confidence:null}`. All 27 are stored either
way, and an omitted key and an explicit null are byte-identical on the row.
MISSING IS NOT NONE is *strengthened* — omitting a key is now how the model says
MISSING, and an explicit denial ("Tenant shall have no option to renew") must
carry its key, because a denial is a finding and not an absence.

**A4 — a failure says why.** Migration 027 adds `abstraction_error text`, one of
six words or null:

| reason | what it means |
|---|---|
| `no_text` | there was no usable text on the row to read |
| `transport` | the request never completed: aborted, or the network went |
| `upstream_timeout` | the server reached Claude; Claude did not answer in time |
| `upstream_error` | the server reached Claude; Claude answered with an error |
| `unparsable` | an answer came back and it was not JSON we could read |
| `no_fields` | valid JSON, but it carried no `fields` object |

It is **not** a sixth `abstraction_status` — a status says where a reading got
to, a reason says why it stopped — and it is **not** `error_message`, which
belongs to the parsing stage and would have been overwritten by it. Two CHECKs:
one of the six or null, and only on a `failed` row, so a reading that later
lands cannot keep wearing the reason its first attempt failed with. A landed
reading and a `skipped` document both clear it explicitly.

### What was NOT done

Not A-durable. Making a server-side success impossible to lose needs the server
to write the row, and the only way to do that without a thirteenth Vercel
function (the Hobby ceiling; `api/` holds exactly twelve) is to put
acquisition-specific write logic inside the generic `/api/claude` task endpoint
— reversing OA-1. The honest limit of the synchronous design, stated rather than
hidden: if the tab closes mid-call, the answer is still lost. Retry is safe and
idempotent (`(review_id, intake_id)`), and "Read terms" already offers it.

`vercel.json`, `lease-intelligence.js`, the P4-2/P4-3 resolver and decision
code, and owner/operator CAM are all untouched.

### Verified

- `test-acquisition-transport.js` — 91 checks. Reads the three constants from
  the three files that set them; drives the real handler with the real
  `AbortController` at 1/1500 scale to prove the 504 fires on its own; and
  reproduces the live failure at 1/1000 scale — a 59s answer is lost under the
  old ceiling and **kept** under the new one, while a 90s answer still aborts.
- `tools/verify-migration-027.js` — 62 checks against a throwaway PostgreSQL
  cluster, including that the evidence stays byte-identical and that the
  rollback takes exactly what 027 added.
- `test-e2e-acquisition-abstraction.js` — all six reasons written through the
  real page into a stand-in enforcing 027's two checks; a failure never
  disturbs evidence the row already had.
- `tools/acquisition-terms-mutation.js` — 59/59 killed, zero survivors,
  including A06, which restores the 58s ceiling and is the live bug itself.

---

## 4j. P4-3 remediation, Issue B — a leasehold can begin

Found in the same live session as Issue A, on the Pilot, 2026-09-22.

### What was wrong

The Maple Plaza review held three correctly classified documents and **zero
leaseholds**, and the Lease Terms panel rendered *"No leasehold has been
identified yet"* — because `_renderAcqTerms` iterates families, and there were
none. The evidence was real and sitting on the rows. It simply had nowhere to
be shown.

Two doors, both shut:

- `proposeFamily` (P1-3) may start a leasehold **only** from an
  `original_lease`. That is right, and nothing here changes it: a machine that
  decides an amendment is the beginning of a lease history has decided
  something it cannot know.
- `acqSetDocType` — the path a **person** takes — ran no family step at all. It
  clears a family on the way OUT (D-17) and did nothing on the way IN.

So the review was stuck. No document in it was an original lease, and
correcting one by hand would not have helped.

### The shape of the fix

A person is in a different position from the classifier: they can see the
document. `familyForCorrection` sits **alongside** `proposeFamily` with two
powers it does not have and one they share.

| Situation | Result | Status / source |
|---|---|---|
| Corrected to `original_lease` | the leasehold **begins** | `confirmed` / `human` |
| "This begins the leasehold" clicked | the leasehold **begins** | `confirmed` / `human` |
| One leasehold already names the tenant | filed there | `proposed` / `ai` |
| More than one names it | nothing written, reason shown, **no** control offered | — |
| No tenant could be read | nothing written, reason shown | — |
| No leasehold on file for this tenant | nothing written, reason shown, control offered | — |

`confirmed` on a new leasehold is honest rather than generous: the family is
created FROM that document and holds only it, so the document being in its own
leasehold is a tautology, not an inference. A tenant-name match is the opposite
— two strings agreeing after normalisation is a machine reading them — so it is
a proposal, and P1-3's rule stands.

### Where a tenant may come from

`tenantHintFor` reads, in order: the P4-1 terms reading of **this** document,
then the tenant record `lease_extraction` produced **from this document**
(`produced_id`). Nothing else. Not the file name, not a sibling, not a guess.
With neither, every caller declines and says so.

### Relatives are offered, never taken

When a leasehold is established, `unfiledSiblings` finds same-tenant documents
in the review that are current, lease-family and unfiled. Each is filed
`proposed` / `ai` with its **own** appended history entry on its **own** row,
and confirmed individually through the control that already exists. There is
deliberately no "accept all": each filing is a separate claim about a separate
document.

### The wording, which is load-bearing

> No matching leasehold found. This document can begin a leasehold if you
> confirm that it belongs to this tenant's lease history.
>
> **[ This begins the leasehold ]**

It does not say MainStreet identified the original lease, because MainStreet
identified nothing. It asks the person to confirm something narrower that they
can check against the document in front of them. The document's **type** is
untouched — an amendment that begins a leasehold is still an amendment.

### D-17 is preserved exactly

The two branches test opposite conditions and cannot both run:

```js
if (AD.isFamilyType(nextType) && !row.family_id)  { …file it… }      // new
if (!AD.isFamilyType(nextType) && row.family_id)  { …clear it… }     // D-17
```

Correcting OUT still clears the family, still PRESERVES `parent_document_id`
and `relationship`, and still flags `relationship_status = 'needs_review'` with
its own history entry.

### No migration

`family_source` already admits `ai | human | inherited` (024), the action word
is the existing `confirmed` rather than a new one `classificationEntry` would
silently coerce, and nothing writes a new column.

### Verified

- `test-acquisition-family-lifecycle.js` — 93 checks, including that
  `proposeFamily` is unchanged branch for branch.
- `test-e2e-acquisition-classification.js` — 90 checks (was 54): §7b–7d walk
  the whole thing in the real page, including the 375px geometry and that the
  page introduces no horizontal scroll.
- `tools/acquisition-classification-mutation.js` — 53/53 killed, zero
  survivors, including **B02**, which puts the Pilot's bug back.

### One thing the walk exposed about the tests themselves

The classification walk's `lease_extraction` stub answered
`tenant_name: 'Coastal Outfitters'` for **every** upload, so a Harbor document
"produced" a Coastal tenant — something that cannot happen in production, where
extraction reads the document in front of it. That unfaithfulness was invisible
until Issue B started reading `produced_id`. Both stubs now derive the tenant
from the text, as the classification stub always did.

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
- `test-e2e-acquisition-documents-mobile.js` — the panel on a phone. Browser
  validation of P1-3 found the document row unusable at iPhone widths: the type
  control and Confirm button made a fourth non-shrinking child, so the only
  flexible one — the file name — resolved to **zero pixels** and
  `SafeShield_Insurance_Lease.pdf` broke one character per line, thirty lines
  tall. The fix is CSS only (the row wraps; the name has a real flex-basis; the
  controls take their own line under 680px). This suite measures the LAID-OUT
  geometry at 375/390/430 and 1280 px, because no reading of the stylesheet
  would have caught it, and it refuses to measure a hidden panel — the first
  version of it reported zeros as passes.

P1-4 / P4-1:

- `test-acquisition-terms.js` — drives `acquisition-terms.js` and the
  document model for real and loads `lease-intelligence.js` in a sandbox:
  group A equals `CANONICAL_FIELDS` byte for byte; the nine approved fields
  are present under their names; the prompt names all 27 exactly once and
  nothing else, says MISSING IS NOT NONE, forbids paraphrase, guessed pages
  and file-name inference; every normaliser leaves null as null and a
  negative word becomes 0 only WITH a quote; an unread value keeps its quote;
  an array is not a value; `buildAbstraction` records every field, drops
  unknown keys, is `failed` with no fields and `partial` with no evidenced
  value; `buildPayload` refuses a claim without its evidence; a missing 025
  column names 025; migration 025 as text adds four columns and touches one
  table; the data layer (source-pinned) asks the server-owned task, skips
  non-family documents, keeps evidence on failure, writes the four columns
  together, reads after store and after classification, re-reads on a
  correction into a family, and reaches no tenant or lease record; and
  **LeaseIntelligence is unchanged** — one-argument signature, no reference
  to the new module, same owner-operator result, no knowledge of the nine.
- `test-e2e-acquisition-abstraction.js` — the walk, against a stand-in that
  enforces migration 025's three checks alongside 024's: a lease is read
  after classification and its row carries 27 fields with a value+quote, a
  null+null for what it does not address, and a denial as a value; one
  upsert writes the four columns under the owner; **nothing was written
  back** to the tenant or the review; a rent roll is `skipped` without a
  call; a failed call is `failed` and the review is unharmed; a rent roll
  corrected into an amendment is read from its stored text (owner-scoped
  read, not a re-upload) and told its new type; corrected back out it is
  `skipped` with its evidence intact; a family-to-family correction does not
  re-read; **Read terms** on a failed row reads it again; the panel chips a
  lease and says nothing on a rent roll; the module and the stand-in refuse
  what 025 refuses; and at 375 px the chip and control leave the file name
  its width.
- `tools/verify-migration-025.js` — **executes** 025 against a throwaway
  cluster on top of 000 + 006 + 023 + 024: applies and re-applies with no
  duplicate constraint, leaves an existing classified row byte-identical and
  `pending` with `{}`, refuses an array/string/number/null as evidence,
  refuses a status outside the five, refuses `success`/`partial` without
  `fields` or without a timestamp while `failed` keeps old evidence, reads a
  stored null back as JSON null and a stored explicit 0 as 0, hides the
  evidence from another user and anon under the existing policy, keeps every
  024 guarantee, rolls back exactly its own objects, and applies again.
- `tools/acquisition-terms-mutation.js` — 38 mutants across the module, the
  document model, the data layer, the migration and rollback SQL, and the
  prompt; each must go red in the three suites above.
- `test-security.js` lists `acquisition_abstraction` among the tasks
  `/api/claude` owns.

P1-4 / P4-2:

- `test-acquisition-resolver.js` — drives the resolver and **executes
  `lease-intelligence.js` from disk**, so the seam is exercised rather than
  described: the reasoner takes an optional field list and ignores a malformed
  one; called with one argument it still reasons over `CANONICAL_FIELDS` and
  an acquisition-only field never reaches that path; the owner-operator
  multi-document result is re-proved; `DOC_TYPE_TIER` is read out of the file
  and asserted unwidened, and the resolver's private copy of it is asserted
  identical; every lease-family type maps onto a reasoner type of its own tier,
  so a renewal outranks its lease. Then the refusing: a superseded, review-level,
  unclassified or unread document is not consulted; a derived figure is
  `unclear` and flagged while a stated one is not; an explicit negative is a
  value and a silence is `missing`; a same-rank disagreement is `conflicting`
  with both values kept and no winner picked; a proposed classification caps
  the term and blocks Confirm with the reason in words; the ceiling follows the
  governing document rather than the best one; a confirmation cannot outrank
  the ceiling; the latest decision wins by timestamp, reopen clears, reject
  keeps the reading, and a decision on one field settles only that field. It
  also pins the increment's boundaries — no network, no DOM, no storage, no
  migration 026, and no Lease Terms UI in `script.js` or `index.html`.
P1-4 / P4-3:

- `test-acquisition-decisions.js` — the eight points the increment was asked to
  prove, in order: the gate refuses Confirm and Correct on an unclassified or
  proposed document while leaving Reject available; a correction records the
  value it replaced and never writes to the document; a rejection keeps the
  reading, the clause and the provenance; a reopen returns the term to the
  documents and removes no history; a contradiction keeps both values and both
  documents; a missing term stays missing in words and offers nothing to
  confirm; a derived figure is flagged rather than presented as quoted; and
  every decision carries an actor taken from the session and a timestamp. Plus
  the write contract, the panel's markup and phone rules, D-17, and migration
  026 read as text.
- `test-e2e-acquisition-terms.js` — the walk, against a stand-in that enforces
  026's append-only trigger, its actor rule, owner-only RLS and its composite
  keys: the panel lists 27 terms per leasehold; Confirm is disabled with the
  reason and clicking it records nothing; confirming the DOCUMENT opens the
  gate; Confirm writes one decision with an actor and a time while the
  evidence stays byte-identical; Correct records `4 → 6` and the document still
  says 4%; Reject keeps the reading and stops presenting it; Reopen leaves all
  three rows; a contradiction shows both values and both file names; a missing
  term reads as a sentence with no controls; the derived figure says it was
  calculated; an UPDATE and a DELETE are both refused; nothing crosses an
  owner; a reload rebuilds every state from the two tables; and at 375 px the
  term keeps its width while the controls take their own line.
- `tools/verify-migration-026.js` — **executes** 026 against a throwaway
  cluster on top of 000 + 006 + 023 + 024 + 025: 83 checks. Append-only is
  refused for the owner as much as anyone, a decision cannot name another
  author, nothing points across owners, RLS admits the owner and nobody else,
  **recording confirm, correct and reject leaves `abstracted_fields`
  byte-identical**, a correction keeps `previous_value`, four acts on one field
  are four rows with the latest in force, deleting a family unfiles its
  decisions while deleting a review takes them, D-17 accepts `needs_review`
  without disturbing the old two values, and the rollback removes exactly
  026 while REFUSING to narrow D-17 under a live `needs_review` row.
- `tools/acquisition-decisions-mutation.js` — 37 mutants across the gate, the
  write contract, the decision overlay, the panel, the data layer, the
  migration SQL and D-17.

- `tools/acquisition-resolver-mutation.js` — 35 mutants across the reasoner
  seam, the document filter, the support check, the five states, contradictions,
  the ceiling, the decision overlay and the lineage cross-check. **34 of 34
  killed; one documented equivalent** (C03: removing `conflicting` from the
  ceiling guard changes nothing today, because `STATE_STRENGTH` has no entry
  for it and a strength of 0 is below every ceiling — the guard protects a
  future edit, and the harness now requires an equivalent mutant to actually
  survive, so a stale exemption cannot hide a real kill).
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
| D-7 | **Financial intake formats.** Which rent roll / GL sources (Yardi, MRI, Excel, scanned PDF)? Sample files decide the parser. **Partly answered by §7: the GL is the primary source and seller invoices are optional, so the GL parser is the one P1-5 cannot ship without.** | P1-5 |
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

---

## 7. The buyer's report — recorded from acquisition-team feedback

**Status: a requirement for P1-5 and P1-7. Nothing in P1-3 changed because of
it, and no code has been written against it.** Recorded here the day it was
given so the increments that need it inherit it rather than rediscover it.

### What the team said

Two things, from people doing this work on real acquisitions.

**The buyer usually does not get the seller's historical CAM invoices.** They
work from the general ledger instead. Seller invoices are a bonus when they
arrive, not an input the review can require.

**Today's Acquisition Decision Report is the CAM/recovery analysis wearing an
acquisition label.** It leads with 311% CAM recovery, Proceed, missed recovery,
CAM leakage, audit windows and tenant CAM allocation. Those are the questions an
*owner-operator* asks about a property they already hold. A buyer in diligence
is asking different ones.

### What that requires

**Invoices are not a required input (P1-5).** The GL is the primary financial
source. A review with a rent roll and a GL and no invoices at all must reach a
complete report; nothing may be blocked, hidden or marked incomplete merely
because seller invoices are absent. Invoice intake stays supported — P1-2
preserves them and P1-3 classifies them — and becomes an enrichment rather than
a prerequisite. The GL parser is therefore the part of P1-5 that cannot slip.

**Acquisition Report v2 answers five questions, in this order (P1-7):**

1. **What am I buying?** The property, its spaces, its physical and legal facts.
2. **What income am I actually buying?** Contractual income from the leases,
   next to what the rent roll claims and what the GL shows — not merged into
   one number.
3. **What obligations am I inheriting?** Landlord work, allowances, options,
   guarantees, restrictions, anything that follows the property to the buyer.
4. **What documents and evidence prove it?** Every figure that matters names the
   document behind it, which is what P1-2 preserved and P1-3 made addressable.
5. **What needs attention before acquisition?** Ranked, and gating completion
   (P1-6).

**Four states, never three.** Every fact in the report is one of:

| state | meaning |
|---|---|
| **verified** | a document supports it, and the report can show which |
| **assumption** | somebody entered or underwrote it; no document behind it |
| **issue** | documents disagree, or a term is unclear |
| **missing** | nothing on file answers this |

**MISSING IS NOT NONE.** A review with no estoppels must say "no estoppels on
file", never "no estoppel issues". A GL with no line for a category must say the
category is unevidenced, not that the expense is zero. This is
ARCHITECTURE_PRINCIPLES §8 applied to money, and it is the single rule most
likely to be lost when a report is made to look tidy.

### What this does NOT change

The committed scope in §1 stands in full and is not narrowed by this note:
document intake with classification and families (P1-2, P1-3), lease
intelligence and governing terms (P1-4), financial/GL/rent-roll intake (P1-5),
Needs Attention (P1-6), the 13-column lease matrix (P1-8), deterministic
evidence-traceable lease Q&A (P1-9), and the deliberate transition into the
acquired-property lifecycle (P1-10). Report v2 is one of the nine areas, not a
replacement for them.

The existing CAM reconciliation product is untouched. It is the right tool for
an owner-operator, and Report v2 is a different report for a different reader —
not a rewrite of it.

## 7a. P1-7 — Acquisition Report v2, R-1 and R-2 (built; awaiting review)

**Status: uncommitted, awaiting approval. Nothing deployed. No migration, no
new serverless function (`api/` still holds twelve).** Built against §7 and the
P1-7 decisions recorded with it (C-1 separate entry point, C-3 assumption
origins, C-4 derived values).

### R-1 — the model (`acquisition-report.js`, frozen)

A pure projection of what P1-4 already knows into §7's five questions. It
decides the report's four states and nothing else:

| P1-4 term state | report state |
|---|---|
| verified | **verified** |
| ai_extracted | **assumption**, `origin: ai_read` |
| unclear, derived (a figure calculated from a rate) | **assumption**, `origin: ai_read`, derived |
| unclear, otherwise (a clause with no readable value, or a value with no clause) | **issue** |
| conflicting | **issue**, with every competing value |
| missing | **missing** |

An assumption always carries its origin — `ai_read` (read by AI, not
confirmed) or `entered` (a person entered it; no document) — and the two are
never counted or drawn under one label. `derived` rides alongside the state
rather than replacing it: a figure calculated from a clause that states a rate
is still verified, an assumption or an issue on its own terms, and is marked
**Derived — calculated from lease terms** wherever it appears. A contradiction
outranks derived: two calculations that disagree are an issue, with each side
still marked derived. The 27 fields are partitioned across Q1 (6), Q2 (10) and
Q3 (11) — total and disjoint, and a test holds it so.

R-1 is frozen: the R-2 view suite pins its sha256
(`c9d2fc8a…bfbe6`), so any change to it has to be deliberate.

### R-2 — questions 3 and 4, drawn (`acquisition-report-view.js`)

A second report beside the existing one, not a rewrite of it. The v1
Acquisition Decision Report (`generateAcquisitionReport`) is byte-for-byte
unchanged, still needs the CAM analysis and invoices, and still lives only
after the analysis has run. v2's control (**📘 Acquisition Report v2**) is on
the Lease Terms card, because v2 needs neither.

`generateAcquisitionReportV2()` re-reads the evidence and the decisions (a
decision recorded in another tab belongs in the report), hands them with the
leaseholds and documents to `AcquisitionReport.buildReport`, and draws the
result with `AcquisitionReportView.renderReport`. It computes no state, drops
no fact, calls no AI and writes nothing.

What the page shows:

- **Coverage first.** "This report currently answers 2 of 5 questions. It is
  not a complete acquisition report." Questions 1, 2 and 5 are drawn in their
  place as not yet included — "Nothing here should be read as an answer to
  this question." — never skipped.
- **Q3, one table per leasehold, all eleven obligations.** A missing term says
  **Not established**. An AI read says **AI-read · not confirmed**. A derived
  figure's clause is led **Calculated from:**, never **Source:**. A
  contradiction reads **Contested**, lists both values each with its own
  document, page and quote, and says **Neither value has been selected.** — and
  names no single Source, which would read as a choice.
- **Entered figures apart.** Anything in `data.assumptions[]` is drawn in its
  own "Entered by a person" table labelled **Entered · no document**. An entry
  does not fill the leasehold's row for the same term; that row stays Missing.
- **Q4, every document.** Whether its original is on file (and an opener that
  asks for a signed link from inside the report when it is), whether its type
  and filing were confirmed by a person or only proposed, and whether it was
  read for terms — with the reason when a read failed.

### What the browser found

Three things the tests passed and the screenshots did not:

- **At 375px** the report tables become cards, and each `<td>` a two-column
  grid — heading on the left, content on the right. A cell with several
  children had them dealt across both columns: a contradiction's two sides
  landed in the heading gutter. Nothing overflowed, so a width check alone
  passed. Every cell now holds its content in one `.acqr-cell` wrapper, and
  the walk checks that nothing a cell says sits left of its content column.
- **At 1280px** report tables set every column but the first to `nowrap`, so
  a clause ran past its table's scroll box and its end was cut off. The v2
  table's own rule lost on specificity; it now wins, and the walk checks that
  no report table scrolls sideways.
- **A contested row also named a single "Source:"** — the evidence of one
  side — directly under "Neither value has been selected", which reads as a
  choice. A contested row's provenance is its competing list, each side with
  its own document, page and quote; the single Source is no longer drawn
  there. The model is unchanged.

### Verified

- `test-acquisition-report.js` 86/86 (R-1, unchanged; sha256 pinned).
- `test-acquisition-report-view.js` 75/75 — every Q3/Q4 row corresponds to the
  model; v1 `generateAcquisitionReport` identical to HEAD; `api/` holds 12; no
  migration 028.
- `test-e2e-acquisition-report.js` 52/52 in the real page — no analysis
  needed; opening writes nothing and calls no AI; the original opens from
  inside the report; a decision and a reading recorded after load both reach
  it; 1280px and 375px layout.
- `tools/acquisition-report-mutation.js` 35/35 killed, no survivors.
- Full regression 200 suites: 196 pass; the 4 failures are the four
  pre-existing ones (Live extraction walk, Billing readiness consistency, Ask
  AI intent coverage, Broken promises).

### Not done in R-2

Q1 and Q2 (R-3), Q5 and the assumptions display beyond Q3 (R-4), and the
closing validation (R-5). No assumption-entry or editing workflow exists or
was added.
