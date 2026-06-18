# Phase 21 — Escrow & Reserve Intelligence
## Pilot Demo / Usability Test Script

Purpose: walk a pilot user (or internal reviewer) through the full reserve
lifecycle end-to-end, in the live app, to validate usability before any
further feature work. ~10–15 minutes.

Branch: `feature/phase21-escrow-reserve-intelligence` (not yet merged to `main`).

---

### Setup
- Have one real or realistic reserve agreement PDF on hand (ideally one
  covering 2+ reserve types, e.g. Roof + HVAC, to exercise the multi-reserve
  extraction path).
- Have 1–2 contractor invoice PDFs and a lien waiver/photo file ready for the
  draw upload step.
- Select or create a test property.

---

### 1. Upload reserve agreement
- Go to the property's **Escrow & Reserves** tab → **Upload Reserve
  Agreement**.
- Upload the PDF.
- **Watch for:** extraction spinner/status, then one reserve card appearing
  per reserve type found in the document (not one merged card).

### 2. Verify reserve extraction and citations
- On each reserve card, confirm: reserve type, current balance, eligible
  uses, and a document count badge.
- Click **Source Citation** on the Roof (or primary) reserve card.
- **Watch for:** the modal shows the verbatim quote and page number Claude
  extracted (e.g. "Lender shall maintain a Roof Reserve Account with an
  initial balance of $75,000..." — Page 3). If a field has no quote, the
  modal should say so rather than show a blank or crash.
- Confirm balances render as `$X,XXX.XX` or `—`, never `$NaN` or
  `$undefined`.

### 3. Create HVAC draw request
- On the HVAC reserve card, click **Create Draw Request**.
- Confirm the invoice picker is pre-filtered to invoices classified as HVAC
  (a "show all invoices" toggle should be available if filtering hid
  anything).
- Enter an amount, submit.
- **Watch for:** draw card appears with a sequential draw number (`Draw #1`
  for this property's first draw) and status `Draft` (or `Submitted`,
  depending on current default).

### 4. Create Roof draw request
- Repeat on the Roof reserve card.
- **Watch for:** draw number increments (`Draw #2`), and the invoice picker
  this time filters to Roof-classified invoices, not the HVAC ones used
  above.

### 5. Upload supporting documents
- On the Roof draw, attach a contractor invoice, a lien waiver, and a photo
  (whatever the upload UI supports for that draw).
- **Watch for:** each attached document appears in the draw's supporting
  document list with a recognizable category label.

### 6. Export draw package PDF
- Click **Generate Package** on the Roof draw.
- In the print/report view, confirm sections appear in order: cover sheet
  (property, draw #, amount, status) → cover letter → property & reserve
  info → Reserve Agreement Citation → Invoice Summary → Supporting Documents
  → Validation Checklist → Status History.
- Use **Print / Save PDF** to confirm it renders cleanly as a PDF (this is
  the browser's native print-to-PDF, not a server-generated file).
- **Watch for:** the validation checklist banner — green "lender-ready" if
  all reserve requirements are met, red "DRAFT" banner if something (e.g. a
  required lien waiver) is missing.

### 7. Generate lender submission email
- Click **Generate Email** on the same draw.
- Confirm Subject follows the `<Reserve Type> Draw Request - <Property>`
  pattern, and Body references the draw number, lists attached document
  categories, and states the requested amount.
- Click **Copy** on both Subject and Body, and click **Open in Email
  Client** to confirm the `mailto:` link populates a real email draft.
- **Note for tester:** the PDF package and any uploaded documents are NOT
  auto-attached to the email — `mailto:` cannot attach files. The user must
  manually attach the exported PDF/documents before sending. Confirm this is
  acceptable for pilot use or flag it as friction.

### 8. Review status history
- Open the Roof draw's package or detail view and check **Status History**.
- Manually change the draw's status if the UI allows it (e.g. via whatever
  status control exists today), then re-open the package.
- **Watch for:** each status change appears as a new row with timestamp and
  actor; the package's Status History section reflects the change without
  needing a page refresh.

---

## Remaining Known Limitations

- **No guided status-transition UI.** Status history is recorded and
  displayed, but there is no dedicated workflow control (e.g. a stepper or
  dropdown enforcing `Draft → Submitted → Under Review → Approved → Funded /
  Rejected`) — this was scoped as Phase 21 Priority 4 and intentionally
  deferred, pending pilot feedback on whether it's actually needed.
- **PDF export is browser print-to-PDF, not a server-generated file.** No
  PDF library, no email attachment automation, no programmatic delivery —
  the user prints/saves and attaches manually.
- **Email generation produces a `mailto:` draft only.** No attachments, no
  SMTP send, no delivery tracking. This is a copy/paste & attach workflow,
  not automated submission.
- **Draw numbers are sequential per-property, not globally unique.** Two
  different properties will both have a "Draw #1"; this is fine for
  per-property lender packages but would need namespacing if draws are ever
  aggregated across a portfolio.
- **Source Citation viewer shows whichever evidence fields Claude
  extracted** — if extraction didn't capture a quote for a given field
  (common on poorly-OCR'd scans), the viewer will say so rather than
  fabricate a citation, but that also means citation coverage is only as
  good as the underlying extraction quality.
- **Reserve-type invoice classification is heuristic** (vendor name/category
  keyword matching with a confidence score), not guaranteed-correct — the
  "show all invoices" override exists specifically because misclassification
  is expected at some rate.

## Open Risks

- **Real-world document variability is the biggest unknown.** All testing
  to date has used synthetic/regression fixtures and the Playwright e2e
  suite's injected fixtures — not a wide sample of real, messy lender
  reserve agreements (multi-column tables, handwritten amendments, scanned
  faxes). Extraction accuracy and citation quality on real pilot documents
  is unverified.
- **No load/volume testing** on properties with many reserves, many draws,
  or many supporting documents per draw — UI and data structures were
  designed for typical single-digit counts.
- **No multi-user/concurrency testing** of simultaneous draw creation or
  status updates on the same property.
- **Browser-print PDF fidelity varies by browser/OS** — Chrome's print-to-PDF
  is the implicit target; Safari/Firefox output has not been checked for
  this report's print stylesheet.

## Recommended Merge Readiness Assessment

**Conditionally ready for a pilot merge, not yet ready for general
availability.**

Engine-layer logic (extraction normalization, draw package assembly, email
drafting, invoice classification) has solid automated coverage — 139/139
unit assertions plus a dedicated 8-section Playwright e2e suite exercising
the full UI flow in a real browser, and the full project regression suite
passes with no regressions. That gives reasonable confidence the *code* is
correct against its own test fixtures.

What's missing before this should be treated as load-bearing for real
customers is **validation against real, messy source documents** — every
test so far has used clean synthetic fixtures. Recommend: merge to `main`
behind the pilot, run the demo script above against 3–5 real reserve
agreements from actual pilot customers, and treat any extraction/citation
misses found there as the gating bugs for GA — not new feature requests.

## Cleanup Items Before Merging to `main`

- [ ] Remove or gate the verbose `[MOUSEDOWN PROBE]` / `[CLICK PROBE]`
  console logging surfaced during e2e runs (visible in `DUMP_CONSOLE=true`
  output) if it's debug instrumentation left in production code paths —
  confirm whether this is dev-only or shipping to prod console.
- [ ] Confirm `escrow-reserve-engine.js` / `escrow-draw-packets.js` are
  included in whatever bundling/minification step `main` uses for
  production script tags (they're currently loaded the same way as
  `lease-intelligence.js` / `lease-review-packets.js`, but worth a final
  check).
- [ ] Decide and document whether Draw Status Workflow (Priority 4) ships
  before or after the pilot, based on pilot tester feedback from Step 8
  above.
- [ ] Squash/rebase the 7 Phase 21 commits into a clean history if `main`'s
  convention favors that before merge (currently left as incremental commits
  for review traceability).
- [ ] Get one pilot user to run this exact script unassisted and capture
  where they get stuck — this script itself should be treated as a draft
  until it's been run by someone who didn't write the feature.
