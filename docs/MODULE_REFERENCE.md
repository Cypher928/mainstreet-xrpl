# MainStreet — Module Reference

Every major module: purpose, responsibilities, I/O, dependencies, public API,
related UI, extension points. All "pure" modules are window-IIFEs with no DOM
access at load time and are Node-testable via `vm`.

---

## command-center.js — AI Command Center
- **Purpose:** the landlord's daily briefing — turns portfolio state into ranked, dollar-quantified actions.
- **Responsibilities:** recommendation generation (disputes, expirations, missing caps, YoY trend, vacancy gap, review queue, run-nudge, reserves ready/shortfall/runway, acquisitions), executive summary narrative, portfolio health scoring, opportunity totals, real-event timeline, settlement rows, scale-capped rendering.
- **Inputs:** `props[]`, `acqReviews[]`, `userName`, injected `deps` (Selectors, EscrowEngine, AcquisitionEngine, computeRecovered, now).
- **Outputs:** `buildModel(...)` → view model; `renderHtml(model)` → HTML string.
- **Depends on:** selectors, escrow-reserve-engine, acquisition-engine, `computeRecoveredRevenue` (script.js global).
- **UI:** `#commandCenter`; glue `showCommandCenter/renderCommandCenter/ccOpenProperty/ccOpenReserves/ccShowPortfolio/ccOpenAcquisitions` in script.js.
- **Extend:** add a recommendation source = one builder emitting the standard rec shape `{id, priority, title, reason, impact, confidence, evidence[], connections[], action}`.

## ai-workspace.js — AI Workspace
- **Purpose:** the conversational layer — every piece of computed intelligence, searchable and actionable in plain English.
- **Responsibilities:** deterministic intent registry (~25 intents), follow-up pre-pass over Workspace Context, evidence scanning (`_scanEvidence`), citations with file/page payloads, reasoning trace, answer rendering with the identity rule.
- **Inputs:** `{question, context{propertyId…}, wctx (workspace context), props, acqReviews, deps}`.
- **Outputs:** `answer()` → `{intent, heading, bullets, paragraphs, citations, actions, confidence, trace, resultSet, context}`; `renderAnswerHtml`; `buildSuggestions`; `registerIntent` (public extension point).
- **Depends on:** selectors, escrow-reserve-engine, acquisition-engine, reconciliation-explainer, computeRecoveredRevenue.
- **UI:** `#aiWorkspace`; glue `openAIWorkspace/aiwAsk/renderAIWorkspace/aiwClear*` holds `_aiwHistory` (capped 30 exchanges) and `_aiwWctx`.
- **Extend:** `registerIntent({id, match(s,ctx,env), handle(q,ctx,env)})`; middleware (voice, LLM paraphrase) wraps `answer()`.

## document-drafting.js — Drafting Studio engine
- **Purpose:** professional documents assembled deterministically from evidence.
- **Responsibilities:** six builders (recovery letter, tenant CAM explanation, lender reimbursement, dispute response, lease review summary, acquisition executive summary); DRAFT status, citations, confidence, `[bracketed human-decision placeholders]`; editable + print HTML.
- **API:** `DOC_TYPES`, `build(type, {props, context, acqReviews, deps})` → doc | null (null = insufficient data, never a fabricated letter), `renderEditableHtml`, `renderPrintHtml`.
- **UI:** `#draftingModal`; glue `openDraftingStudio/dftSave/dftExport/dftOpenSaved`. Saved drafts persist as `property.aiDrafts`.
- **Extend:** one builder function per new doc type + a `DOC_TYPES` entry.

## evidence-viewer.js — Interactive Evidence Viewer
- **Purpose:** every citation opens the source document at the cited page with the quote highlighted.
- **Responsibilities:** 3-tier honest degradation; quote location in pdf.js text layers (`locateQuoteInItems` — normalization-tolerant, refuses low-confidence matches); in-document search; adapters `fromReserve`/`fromTenantField`; chip protocol (`data-evd` payload on answers, `openFromChip`).
- **Depends on:** window.pdfjsLib (already app-wide), fetchable Supabase Storage URLs.
- **Extend:** any doc type is `{fileUrl, citations[]}` — no viewer changes needed.

## escrow-reserve-engine.js — Reserve Intelligence
- **Purpose:** lender reserves decoded; reimbursements de-risked.
- **API:** `normalizeReserve`, `mergeReserveExtractions`, `computeReserveBalance`, `validateDrawRequest`, `applyDrawStatus` (state machine), `buildDrawRequestPackage`, `buildDrawEmailDraft`, `computeEscrowReadiness` (score + conversational summary), `computeReserveHealth`, `projectReserveRunway`, `buildReserveNarrative`, `classifyReserveType`, `classifyInvoiceReserveType`, `deriveReserveExtractionConfidence`.
- **Persistence:** `property.escrowReserves[]`, `property.drawRequests[]`.
- **Tests:** `test-reserve-engine.js` (182 assertions, regression-wired).

## selectors.js — Derived state
- **Purpose:** all display metadata derived from canonical property data; no globals, no DOM.
- **API:** `buildPropMeta`, `portfolioKPIs`, `derivePropertyReadiness`, `computePortfolioIntel`, `getReviewQueueItems`, `computeReviewHealth`, `sortProperties` (per-sort health memoization), `propCardBullets`.
- **Note:** consumed by portfolio UI, Command Center, and Workspace alike — the single source of derived truth.

## Reconciliation stack
- **allocation-engine.js** — pure pro-rata/caps/exclusions math (unit-tested; the money engine).
- **reconciliation-engine.js / allocation-integrity.js** — orchestration + cross-checks.
- **reconciliation-explainer.js** — tenant-facing narratives (`buildReconciliationSummaryNarrative`, `buildExplainability`) reused by Workspace + Drafting.
- **Persistence:** `property.camReconciliation` snapshot + normalized `cam_reconciliations` rows.

## acquisition-engine.js — Acquisition Intelligence
- **API (consumed):** `computeRevenueAtRisk`, `computePortfolioIntelligence`, `computeRenewalPipeline`, `computeRevenueForecast`, `computePortfolioActions`.
- **UI:** acquisition review section (portfolio), Decision Report; feeds Command Center + Workspace.

## acquisition-workspace.js — Acquisition Review record (Phase 1, P1-1)
- **Purpose:** the one owner of an `acquisition_reviews` row's shape, its stage and its activity history. See `docs/ACQUISITION_REVIEW.md`.
- **Responsibilities:** `upgradeReview` (idempotent; adds missing v2 keys, never removes or rewrites), `newReviewData`; `STAGES` / `stageOf` / `deriveStage` / `setStage` / `markAcquired` / `markReverted`; `recordActivity` (appended, attributed, capped with `activityDropped`); `stageChips` view model; `savePayload` + `classifySaveResult` — the two halves of the conditional save (no row matched under a revision filter ⇒ `conflict`, never success).
- **Inputs/Outputs:** pure functions over the row `{ id, user_id, name, status, data, updated_at }`; every function returns a new row and leaves its input untouched.
- **Depends on:** nothing. **Consumed by:** script.js acquisition glue (`_acqAdopt`, `_acqRecord`, `_saveAcqReview`, `_acqHandleSaveConflict`, `_renderAcqStageChips`, `acqSetStage`).
- **Tests:** `test-acquisition-workspace.js`, `test-e2e-acquisition-workspace.js`, `tools/acquisition-workspace-mutation.js`.

## acquisition-documents.js — Acquisition Review document contract (Phase 1, P1-2)
- **Purpose:** what may be written about a document an acquisition review was given, and how its row is addressed. Replaces `api/acquisition-documents.js`, which was the 13th Serverless Function in `api/` and could not deploy on the Hobby plan's limit of 12. See `docs/ACQUISITION_REVIEW.md` §4b.
- **Responsibilities:** `buildPayload(reviewId, userId, fields)` — camelCase in, snake_case out, through the `WRITABLE` allow-list, with `user_id` from the session and every unknown key dropped; `LIST_COLUMNS` / `LIST_SELECT` (deliberately without `extracted_text`); `CONFLICT_KEY` = `review_id,file_name`; `isMissingTable` (`42P01`) and `migrationFor(table)`, which names the migration for the table that is actually absent.
- **Ownership is NOT enforced here.** It is migration 023's RLS policy (`user_id = auth.uid()`, no anon policy) and its composite foreign key `(review_id, user_id)` → `acquisition_reviews (id, user_id)`. This module only makes sure the row it builds names the signed-in user, so the key has something to refuse.
- **Inputs/Outputs:** pure functions; no DOM, no network, no globals.
- **Depends on:** nothing. **Consumed by:** script.js's `_acqLoadDocuments` and `_acqSaveDocument`, which apply it through the authenticated Supabase client.
- **Also owns the P1-3 document model:** `DOC_TYPES` (the vocabulary, with the tiers `LeaseIntelligence.DOC_TYPE_TIER` already uses, so P1-4 feeds `reasonMultiDocumentLease` rather than a second reasoner) and `docTypeLabel` / `docTypeTier` / `isFamilyType`; `normalizeParty` (case, punctuation and company form only — no fuzzy matching); `proposeFamily` and `proposeRelationship`, which decline far more often than they propose and return a reason a person can read; `classificationEntry` / `appendHistory` (append-only, bounded audit trail); `findSuperseded` / `isCurrent` for D-14; `orderWithinFamily` (tier then date, replaced uploads last); `groupDocuments` (Needs review → families → review-level, every document exactly once); `describeClassification`, which never lets a proposal render as verified; `buildFamilyPayload`.
- **P1-4 (P4-1):** the four abstraction columns join `WRITABLE`/`CAMEL`; the list select carries the status, model and time but **not** the evidence; `buildPayload` refuses `success`/`partial` without a `fields` key and a timestamp; `migrationForError` is column-aware (`missingColumnName`, `MIGRATION_FOR_COLUMN`) so a missing 025 column names 025 rather than 024.
- **Tests:** `test-acquisition-documents.js`, `test-e2e-acquisition-documents.js`, `tools/acquisition-documents-mutation.js`, `tools/verify-migration-023.js`, `test-acquisition-classification.js`, `test-e2e-acquisition-classification.js`, `tools/acquisition-classification-mutation.js`, `tools/verify-migration-024.js`, `test-acquisition-terms.js`.

## acquisition-terms.js — Acquisition Review lease terms: the vocabulary and the evidence (Phase 1, P1-4 / P4-1)
- **Purpose:** the 27 lease terms an acquisition review reads for, and the shape of what ONE document says about each — value, verbatim quote, page, confidence. See `docs/ACQUISITION_REVIEW.md` §4d–§4e. P4-2 adds the resolver (`buildReasonerInput`, `resolveTerms`) on top of this file; P4-1 is only the evidence layer.
- **One vocabulary:** `FIELD_GROUPS.canonical` is `LeaseIntelligence.CANONICAL_FIELDS` verbatim (a test asserts it against that file); `extracted` is the five `lease_extraction` already returns and nobody governs; `acquisition` is the nine the approved plan named. `FIELD_META` types each field (number · money · percent · date · boolean · enum · text) with the enum vocabularies from `lease_extraction`.
- **Missing is not none:** `normalizeFieldValue` never turns null into 0, false or ""; the one coercion it makes is the reverse — a negative word for a number field, WITH a quote, becomes 0, because that is what the document said. An unreadable value keeps its quote (P4-2 calls that `unclear`). `buildAbstraction(reading, {model, at})` → `{ ok, status ∈ failed · partial · success, abstraction: { schemaVersion: 1, model, at, fields: {every field} }, counts }`, unknown keys dropped. `summarizeAbstraction`, `isAbstractable(docType)` (the lease-family predicate; same answer as `AcquisitionDocuments.isFamilyType`).
- **Inputs/Outputs:** pure functions; no DOM, no network, no globals. Loaded after `acquisition-documents.js`, before `script.js`.
- **Consumed by:** script.js's `_acqAbstractDocument` (intake hook after store + classification; re-read on a correction into a lease family; `skipped` on a correction out), `acqReabstractDocument` (the panel's **Read terms**), and the panel chip. The model prompt is `acquisition_abstraction` in `api/_claude-tasks.js`, which names the same 27 fields and is held equal by test.
- **Also owns the P4-2 resolver:** `buildReasonerInput(documents)` maps a family's CURRENT, lease-family, actually-read documents into the shape `LeaseIntelligence.reasonMultiDocumentLease` already takes, via `REASONER_DOC_TYPE`, which maps our nine types onto the reasoner's four so each keeps the tier P1-3 gave it. `resolveTerms(reasonerResult, documents, decisions)` applies the five states (`verified · ai_extracted · conflicting · unclear · missing`), the classification ceiling, and the human decision overlay; `resolveFamilyTerms(documents, decisions, { reasoner })` does both. `evidenceSupport(field, entry)` answers whether the clause actually STATES the value or the value was DERIVED from it — the `base_rent` case from the live P4-1 run — and a derived figure is kept with its clause but never reads as evidenced. Contradictions come from the reasoner verbatim and are never auto-resolved; `lineageMismatch` flags a reasoner answer the documents do not support.
- **The one change to `lease-intelligence.js`** is `reasonMultiDocumentLease`'s optional second argument (`options.fields`). Omitted or malformed, it behaves exactly as before; `DOC_TYPE_TIER` is deliberately NOT widened.
- **Also owns the P4-3 decision contract:** `buildDecisionPayload(reviewId, userId, fields, term)` — camelCase in, snake_case out, `decided_by` forced to the session's user whatever the caller passed, `previous_value` taken from the term when the caller omits it, and **the classification gate**: Confirm and Correct are refused with the reason while the governing document is `unclassified` or `proposed`, while Reject and Reopen are not gated. `DECISION_COLUMNS` / `DECISION_SELECT`, `latestDecision(decisions, field)` (latest by `decided_at`; a `reopen` clears). Nothing here writes `abstracted_fields` — the AI reading and the human decision stay separate records.
- **Tests:** `test-acquisition-terms.js`, `test-e2e-acquisition-abstraction.js`, `tools/verify-migration-025.js`, `tools/acquisition-terms-mutation.js`, `test-acquisition-resolver.js`, `tools/acquisition-resolver-mutation.js`, `test-acquisition-decisions.js`, `test-e2e-acquisition-terms.js`, `tools/verify-migration-026.js`, `tools/acquisition-decisions-mutation.js`.

## Reports
- **lease-review-packets.js** (lender summary etc.), **escrow-draw-packets.js** (draw package), plus script.js report generators (Master, Reconciliation Summary, Tenant Statements, CSV exports). Pattern: engine data → HTML → print window.

## Settlement (see XRPL_ARCHITECTURE.md)
- **rlusd-integration.js** — network config, wallet/trust-line/payment builders (SourceTag + SHA-256 memo), `getAccountStatus`, `settleRlusdPayment`.
- **api/rlusd-settlement.js** — read-only `status`.
- **scripts/** — generate-settlement-wallet (seed→private file), setup-trust-line, send-xrp, send-settlement (dry-run default), verify-settlement (multi-endpoint, wallet-only mode), wallet-address (seed↔address check). All hidden-prompt seeds.

## Authentication & roles
- **auth-service.js** — Supabase session, user hydration; **access-control.js** — role gating (tenant portal vs landlord). Landing routes landlords to the Command Center; tenant flow untouched by all Phase 21+ work.

## Persistence (script.js — the pipeline)
- `saveProperty` (whitelisted `data{}` + localStorage mirror, generation-guarded), `loadProperties` (light list), `loadPropertyData` (blob map + LS merge + normalized-table overlays), `selectProperty` apply, `normalizePropertyState` (schema guards). **Four-hop invariant** — see TESTING_GUIDE.md.

## Shared utilities
- `audit-service.js` (SHA-256 audit fingerprints, audit rows), `esc/fmt` helpers in script.js, guided-tour.js (adaptive step builder), qa-harness/lease-test-lab/escrow-verification-fixtures (dev fixtures), dev-switcher.js (localhost role switcher).
