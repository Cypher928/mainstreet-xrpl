# Phase 21 Verification Pack — Escrow & Reserve Intelligence

This document is the verification report requested for Phase 21. It covers four
things: real-world reserve-document testing, extraction confidence, source-page
citations, and an honest accounting of what has and hasn't actually been observed
running.

Branch: `feature/phase21-escrow-reserve-intelligence`

---

## 1. What changed in this cycle

Before this cycle, Phase 21's extraction prompt and pipeline had two problems that
only show up with real lender documents, not with the engine's unit tests:

1. **No confidence signal, no citations.** The reserve profile showed numbers
   with no way for a property manager to check them against the source document.
2. **Silent truncation bug.** `callClaudeForEscrowDocument()` was reusing
   `prepareLeaseTextForClaude()` — a lease-specific helper that keyword-boosts
   lease vocabulary (tenant, lessee, rent, square footage…) and truncates input to
   the first 4,000 + last 2,000 characters. For a 20–30 page mortgage agreement
   with the reserve clause buried in the middle (exactly the user's Test Set C
   scenario), this would silently drop the reserve language before it ever
   reached Claude.

Fixes made:

- **`escrow-reserve-engine.js`** — added `deriveReserveExtractionConfidence()`,
  modeled on the existing `lease-intelligence.js` confidence pattern. Score starts
  at 70; +8 per trust-critical field (`reserve_type`, `current_balance`,
  `eligible_uses`) that has a verbatim quote; −3 if quoted but missing a page
  number; −12 if no quote at all; −10 if the extraction path was the scanned-PDF
  vision fallback; −10 if the source text was unusually thin (<500 chars).
  Clamped to [0,100], mapped to high/medium/low/failed the same way the lease
  engine does. `normalizeReserve()` now returns `evidence`, `sourcePages`
  (deduped, sorted), and `extractionConfidence` instead of the old `quotes` field.
- **`script.js`**
  - `CLAUDE_ESCROW_SYSTEM` and the PDF-direct vision prompt now ask Claude for an
    `evidence: { reserve_type: {quote, page}, current_balance: {quote, page},
    eligible_uses: {quote, page} }` block — verbatim quotes (≤160 chars), page
    numbers sourced from the `--- Page N ---` markers `extractPdfText()` already
    injects (this infrastructure already existed for Ask-the-Lease citations, so
    no new PDF-parsing work was needed). Claude is explicitly told to return
    `null` for page rather than guess.
  - Added `prepareEscrowTextForClaude()` — sends up to 120,000 chars of the full
    normalized document with no truncation or keyword bias, and switched
    `callClaudeForEscrowDocument()` to use it instead of the lease-specific
    helper. This is the actual fix for the buried-clause risk.
  - `handleEscrowDocumentUpload()` now tracks which extraction path ran
    (`'text'` vs `'pdf_vision'`) and the source text length, and passes both into
    `normalizeReserve()` so confidence scoring can account for them.
  - `renderEscrowProfile()` now shows a confidence badge (High/Medium/Low),
    a "Source: Page N, Page M…" line, and an italicized evidence quote per
    reserve card.
- **`index.html`** — added `.escrow-conf-badge` / `-high` / `-medium` / `-low` and
  `.escrow-source-pages` styling.
- **`test-reserve-engine.js`** — added 9 new assertions (Group 2b) covering the
  confidence formula and source-page extraction. Full suite is now **88/88
  passing**.

---

## 2. Test Set A — Clean Digital PDF

**Fixture:** `escrow-verification-fixtures.js` → `cleanDigital` (3 pages, ~2.2k
chars). A reserve/escrow agreement naming a Roof Reserve ($75,000, requires
invoices + photos + lien waivers), HVAC Reserve ($40,000, two-bid threshold over
$10k), and Capital Reserve ($150,000, no minimum draw), plus a reserve expiration
date and a 180-day repair completion deadline.

**Status: packaged, not run.** This sandbox has no `ANTHROPIC_API_KEY` available
(confirmed — only Claude Code's own internal session/OAuth variables are present,
none usable against the public Anthropic Messages API). Network egress to
`api.anthropic.com` is reachable from this sandbox, but calling the live API
deliberately requires a real key, which is absent here on purpose.

What *is* verified: the fixture text, the live `CLAUDE_ESCROW_SYSTEM` prompt
extracted directly from `script.js` (not copy-pasted, so it can't drift), and the
real `EscrowReserveEngine.normalizeReserve()` are wired together correctly in
`test-escrow-extraction-verification.js`, and the script's no-key path was run and
confirmed to print a clear BLOCKED banner and exit 0 (not a failure).

**To actually run this test:**

```bash
ANTHROPIC_API_KEY=sk-ant-... node test-escrow-extraction-verification.js
```

This must be done in an environment with real API credentials — locally, in CI,
or in the deployed environment.

---

## 3. Test Set B — Scanned/Image-Only PDF

**Cannot be exercised in this sandbox at all,** independent of API-key
availability. It requires two things this environment cannot provide:

1. A real scanned/image-only PDF — not synthesizable as meaningful raster content
   in a headless text-only sandbox.
2. The actual browser upload flow, so PDF.js's text-layer extraction genuinely
   returns weak/empty text and `handleEscrowDocumentUpload()` falls through to
   `callClaudeForEscrowDocumentPdfDirect()` (the base64 vision path). This branch
   cannot be reached by feeding text fixtures into a Node script.

The user is right that this is likely the most important test in the set, since
lenders frequently send poor-quality scans. It must be run manually:

**Manual procedure:**

1. Obtain (or scan-to-image) a real lender reserve document — image-only PDF,
   no text layer.
2. In the deployed/local app, open a property → Escrow tab → upload the scanned
   PDF.
3. Open the browser console and confirm:
   - PDF.js text extraction returns near-empty text (or the app's existing
     low-text-confidence check trips).
   - The vision fallback path activates (`callClaudeForEscrowDocumentPdfDirect`
     is the function on the call stack / its log line fires).
4. Confirm the resulting Reserve Profile populates with the same shape as Test
   Set A (reserve type, balance, eligible uses, requirements) and that the
   confidence badge reflects the path penalty (−10 for `pdf_vision`) — i.e. it
   should generally read Medium rather than High even on a clean scan, since
   there's no page-marker text for citations in the vision path.
5. Confirm source pages are still populated (Claude is told "page 1 = first page
   of the PDF" in the vision-path prompt, with no text markers to anchor to).

---

## 4. Test Set C — Messy Legal Language

**Fixture:** `escrow-verification-fixtures.js` → `messyMortgage` (25 pages,
~19.7k chars — comfortably past the old 6,000-char truncation window that this
cycle's fix removed). Pages 1–16 and 20–25 are generic unrelated mortgage
boilerplate (covenants, definitions, events of default, etc.); pages 17–19
contain the real "Repair Reserve" clause: $62,500 balance, requires itemized
contractor invoices + lien waivers, $2,500 minimum draw, repair completion
deadline March 1 2027, draw-request deadline = last business day of each month,
reserve expiration June 30 2027, engineer certification required only above
$25,000.

**Status: packaged, not run** — same `ANTHROPIC_API_KEY` constraint as Test Set A.
`test-escrow-extraction-verification.js` includes assertions specifically
targeting this scenario's risk: that the balance/deadlines are correctly pulled
from the buried clause, that the cited source page is >10 (i.e. genuinely from
the buried section, not a hallucination near the document edges), and that no
content from the surrounding boilerplate (e.g. "single-purpose entity," "yield
maintenance") leaks into the extracted `eligibleUses`/`notes`.

What *is* verified without the API: the fixture is provably long enough to have
broken the old truncation logic (the reserve clause sits ~14k characters into a
~19.7k character document — past the old 4,000-char head window, and the
document's tail-2,000-char window would not have reached it either), and the
fixed `prepareEscrowTextForClaude()` sends the full document with no truncation,
so the reserve clause is no longer dropped before Claude sees it. This is a
necessary precondition for the test to be able to pass; it is not the same as
having observed Claude actually extract it correctly.

---

## 5. Extraction Confidence

Implemented and unit-tested (not dependent on live API access — these are pure
function tests against `EscrowReserveEngine.deriveReserveExtractionConfidence`):

- Full evidence (quotes + pages) on all three trust-critical fields → High.
- Partial evidence / missing page numbers → Medium.
- No evidence at all → Low.
- `pdf_vision` extraction path and thin OCR text both apply score penalties.

9 new assertions in `test-reserve-engine.js` Group 2b, all passing (88/88 total
suite).

The UI renders this as a colored badge (High/Medium/Low) on each reserve card —
this has not been visually confirmed in a running browser in this sandbox, only
confirmed by reading the rendering code and CSS.

---

## 6. Source-Page Citations

Implemented by extending the extraction schema to request
`evidence.{field}.{quote, page}` for `reserve_type`, `current_balance`, and
`eligible_uses`, reusing the `--- Page N ---` marker infrastructure that
`extractPdfText()` already injects for Ask-the-Lease. `normalizeReserve()`
aggregates these into a deduped, sorted `sourcePages` array, and
`renderEscrowProfile()` displays them as "Source: Page 17, Page 19" plus an
italicized verbatim quote. Verified at the engine level via unit tests; not yet
verified against a real Claude response (gated on the same API-key constraint as
Test Sets A/C).

---

## 7. Honest summary

| Item | Status |
|---|---|
| Confidence scoring engine | ✅ Implemented, unit-tested (9 new assertions, 88/88 passing) |
| Source-page citation plumbing | ✅ Implemented, unit-tested |
| Truncation bug (buried reserve clauses) | ✅ Found and fixed (`prepareEscrowTextForClaude`) |
| Test Set A (clean PDF) — live extraction | 📦 Packaged and ready to run; **not executed** — no API key in this sandbox |
| Test Set B (scanned PDF) | 📦 Manual procedure documented; **cannot be executed** in any headless sandbox — needs a real scanned PDF + browser upload flow |
| Test Set C (buried clause) — live extraction | 📦 Packaged and ready to run; **not executed** — no API key in this sandbox |
| Full regression suite | ✅ `node test-regression.js` — all 15 suites pass |

**What this report is not claiming:** that real lender documents have been
verified to extract correctly. That claim can only be supported by actually
running `test-escrow-extraction-verification.js` against the live API and by
manually running Test Set B through the browser upload flow. Both are now teed
up to do exactly that — they just need to be run somewhere with real credentials
and a real browser, neither of which this sandbox has.

**To complete verification:**

```bash
# Test Sets A & C (requires a real Anthropic API key)
ANTHROPIC_API_KEY=sk-ant-... node test-escrow-extraction-verification.js

# Test Set B (manual, requires a real scanned lender PDF + the deployed app)
# See "Manual procedure" in Section 3 above.
```
