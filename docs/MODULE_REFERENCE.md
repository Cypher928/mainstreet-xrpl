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
