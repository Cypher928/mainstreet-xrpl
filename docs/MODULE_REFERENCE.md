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
- **Tests:** `test-acquisition-documents.js`, `test-e2e-acquisition-documents.js`, `tools/acquisition-documents-mutation.js`, `tools/verify-migration-023.js`, `test-acquisition-classification.js`, `test-e2e-acquisition-classification.js`, `tools/acquisition-classification-mutation.js`, `tools/verify-migration-024.js`.

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
