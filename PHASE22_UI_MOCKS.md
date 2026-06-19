# Phase 22 — Lease Audit & Estoppel Intelligence
## UI Mock Descriptions (text-based — no visual mockups produced yet)

Status: **Planning only — no implementation.** These describe intended
layout and interaction, following existing UI conventions already in the
app (modal-backdrop/modal-box pattern, `.escrow-*`-style card/citation
conventions from Phase 21, `openReport()` print surface). No new visual
design language is introduced.

---

## 1. Estoppel upload entry point

On a tenant's detail view (where Lease Intelligence already shows extracted
lease fields), add a new button: **"Upload Estoppel Certificate"** —
visually consistent with the existing "Upload Reserve Agreement" button on
the Escrow tab. Once an estoppel is uploaded and extraction completes, the
button is replaced with a small status chip: **"Estoppel on file — Audit:
HIGH RISK"** (color-coded red/amber/green matching the worst verdict),
clicking it opens the Lease Audit Report (see §3).

## 2. Estoppel Comparison view (inline, before generating the full report)

A compact table directly below the tenant's lease summary, structurally
similar to the Reserve card's document-management row from Phase 21:

```
┌─ Lease vs. Estoppel Comparison ──────────────────────────────┐
│ Field              Lease          Estoppel        Status      │
│ Tenant Name        Acme Corp      Acme Corp        ✅ Match    │
│ Suite              204            204              ✅ Match    │
│ Base Rent          $4,200.00      $4,200.00        ✅ Match    │
│ Security Deposit   $8,500.00      $8,400.00        ⚠️ Mismatch │
│ Lease Expiration   2027-03-31     2027-03-31       ✅ Match    │
│ Renewal Options    1×5yr @ FMV    (not stated)      🔴 Omitted │
│ TI Allowance       $0.00          $0.00            ✅ Match    │
│ Landlord Oblig.    Roof repair    (not stated)      🔴 Omitted │
└────────────────────────────────────────────────────────────────┘
           [ Generate Lease Audit Report ]
```

Each row is clickable to expand the citation pair (lease quote + page,
estoppel quote + page or "not mentioned in estoppel") — directly reusing
the citation-modal pattern from Phase 21's Source Citation Viewer, but shown
inline/expandable rather than in a separate modal, since two citations need
to be visible side by side for comparison (a separate modal per field would
make the side-by-side comparison harder to follow).

## 3. Lease Audit Report (print/PDF surface)

Rendered into the existing `#reportOverlay` / `#rptBody`, following the
exact section order convention already established by
`escrow-draw-packets.js` and `lease-review-packets.js`:

1. **Cover sheet** — tenant name, property, "Lease Audit Report", generated
   date, overall verdict banner (green "lender-ready" or red "discrepancies
   found" — same banner convention as the Escrow draw package's
   validation-checklist banner).
2. **Cover letter** — short auto-generated summary paragraph.
3. **Audit Findings table** — one row per field:
   ```
   PASS       Base Rent matches
   WARNING    Security Deposit mismatch ($8,500 lease vs. $8,400 estoppel)
   HIGH RISK  Renewal option omitted from estoppel
   ```
   Each row colored consistent with severity (green/amber/red), matching
   the ✅/⚠️/❌ convention already used in
   `escrow-draw-packets.js::_validationChecklist`.
4. **Citation appendix** — both source quotes per flagged field, so a
   lender reviewing the PDF doesn't need to open the underlying documents.
5. **Footer** — same brand/property/generated-date footer convention used
   by every other report in the app.

## 4. Acquisition Risk Summary (within existing Acquisition Review screen)

Add one new collapsible section to the existing Acquisition Review report,
positioned after the existing CAM/reconciliation sections, before the
closing risk-ranking ("top risks") section that already exists:

```
┌─ Acquisition Risk Summary ────────────────────────────────────┐
│ Missing Documents (3)        ▸ expand                          │
│ Lease Exceptions (5)         ▸ expand                          │
│ Expiring Leases (2)          ▸ expand                          │
│ Estoppel Conflicts (1)       ▸ expand   ← NEW                  │
│ CAM Recovery Risk ($14,200)  ▸ expand                          │
└──────────────────────────────────────────────────────────────┘
```

Each category expands to a short list, consistent with how the existing
Acquisition Review already lists `topRisks`. "Estoppel Conflicts" is the
only category specific to this phase; the other four reuse existing data
already computed by `buildAcquisitionReport()` and `lease-review-packets.js`
— this section is primarily an aggregation view, not new visual design.

## 5. Document Comparison Workspace (long-term capability — minimal UI in
   this phase)

For Phase 22, the workspace is **not** a standalone screen — it's the
inline comparison view in §2, scoped to lease-vs-estoppel only. Proposal:
defer building a generic "pick any two documents and compare" workspace UI
until a second comparison pair (e.g. amendment-vs-original) is actually
needed, since premature UI generalization without a second real use case
risks guessing wrong about what that workspace needs to look like. The
*engine* is generalized now (per the architecture doc); the *UI* is not.

## 6. Interaction states to design for (flagged, not mocked in detail)

- No estoppel uploaded yet → no comparison table, just the upload button.
- Estoppel uploaded but extraction failed/low-confidence → show a warning
  state consistent with existing low-confidence extraction banners
  elsewhere in the app (e.g. Lease Intelligence's existing confidence
  display), not a silent failure.
- Estoppel re-uploaded (replacing a prior one) → reuse the "Replace"
  document-management pattern from Phase 21's reserve cards, including the
  re-extraction/reprocess flow.
