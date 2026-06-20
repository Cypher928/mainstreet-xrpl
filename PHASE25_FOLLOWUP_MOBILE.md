# Phase 25 Follow-Up — Mobile Polish (Not Blockers)

**Discovered during:** Phase 25 visual QA verification pass (`test-e2e-phase25-visual.js`)
**Status:** Tracked for future mobile-polish work. Both predate Phase 25 and are not regressions
introduced by it — Phase 25 reused the existing card/header patterns rather than authoring new
ones, and inherited these two pre-existing issues in the process.

---

## 1. Property card CTA tap-target sizing on mobile

**Where:** `.ptf-card-open-btn` (index.html) — the "Open Demo" / "Open" button rendered on every
portfolio property card, real and demo alike.

**Issue:** Renders at `padding: 3px 9px; font-size: 0.62rem`, measuring ~19px tall at a 390px
mobile viewport. Common mobile tap-target guidance (Apple HIG / Material Design) recommends
~28-44px minimum.

**Why it matters now:** Phase 25 added two demo property cards that use this same button to
launch the CAM and acquisition demos. The button's small size now also gates first-time mobile
discovery of those demos, not just navigation on existing real-property cards.

**Suggested fix (future):** Increase `.ptf-card-open-btn` padding/min-height on mobile via a
`@media (max-width: 480px)` override, consistent with the existing mobile overrides already
present for `.ptf-cards-grid` and `.ptf-kpi-bar`.

---

## 2. Portfolio header action row overflow on narrow screens

**Where:** `.ptf-head-actions` (index.html) — the "Your Properties" header row containing the
tenant search box, "Export Summary," and "+ Add Property."

**Issue:** The row is a non-wrapping flex container (`display: flex; ... flex-shrink: 0`) with a
fixed-width search input. At a 390px viewport, the row overflows ~200px past the right edge of
the screen, causing horizontal scroll on the entire portfolio dashboard.

**Confirmed via:** Direct DOM geometry scan during QA (`getBoundingClientRect()` on all elements,
filtering for `right > clientWidth`) — not visual inspection alone. Offending elements:
`.ptf-head-actions`, `.ptf-export-btn`, `.add-prop-btn`.

**Suggested fix (future):** Add a `@media (max-width: 480px)` rule allowing `.ptf-head-actions`
to wrap (`flex-wrap: wrap`) or stack vertically, and let the search input shrink to `width: 100%`
on its own row.

---

## Disposition

Both items were intentionally treated as out of scope for Phase 25 (UI/copy/data-only, no new
infrastructure) and are not blockers for the Phase 25 merge. Recommended as a small, contained
mobile-polish follow-up phase touching only `index.html` CSS.
