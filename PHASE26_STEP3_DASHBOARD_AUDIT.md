# Phase 26 — Step 3: Dashboard Information Hierarchy Audit

**Status: Audit & recommendations only. No code changes made.**

This covers KPI ordering, Action Center priority rules, property card information
hierarchy, and urgency scoring, per the scope requested. Findings are based on direct
code inspection of `script.js`, `index.html`, `acquisition-engine.js`, and `selectors.js`.

---

## 1. KPI Tile Ordering

**Location:** `index.html:5075-5100` (markup), `script.js:16910-16917` (render),
`selectors.js:168-206` (`Selectors.portfolioKPIs`).

Current fixed order: **Properties → Occupancy → Total CAM Managed → Ready to
Reconcile → In Progress → Needs Review**.

The DOM order is hardcoded; the *values* are computed live from `derivePropertyReadiness()`
per property.

**Recommendation:** Reorder to put action-oriented tiles before descriptive ones.
Properties/Occupancy/CAM are "state" metrics; Ready/In Progress/Needs Review are
"what needs my attention" metrics. Suggest:
**Needs Review → In Progress → Ready to Reconcile → Properties → Occupancy → Total CAM**.
This puts the tile most likely to drive a click first, consistent with the
Action Center's "urgent first" pattern below. Low risk, no logic change — pure
DOM reorder of existing tiles.

---

## 2. Action Center Priority Rules

**Location:** `script.js:15963-16088` (`renderActionCenter`),
`acquisition-engine.js:1150-1283` (`computePortfolioActions`).

Already well-structured: three explicit severity tiers (critical/warning/info),
each capped (5/5/3 items), sorted by `daysToExpiry` within tier. Sources: lease
expiry (≤30d critical, 31-90d warning), open CAM disputes (always warning),
vacant space ≥500sf (always info), acquisitions ready for conversion (always info).

**Issues found:**
- **No numeric urgency shown in the compact list** — a lease expiring tomorrow and
  one expiring in 30 days both render identically as "critical" with no
  days-remaining visible (only shown in the separate Renewal Pipeline view).
- **Dispute severity is flat** — *every* open dispute is "warning" regardless of
  dollar exposure or age; a $50 dispute and a $50,000 dispute look the same.
- **CAM audit risk (Critical/Elevated/Moderate/Low, computed in
  `buildAuditNarrative()`, script.js:12101-12110) never feeds the Action Center**
  — a property can show "Critical" CAM risk on its card but appear nowhere in
  the Action Center if it has no open dispute or near-term lease expiry. Two
  parallel risk vocabularies exist with no cross-reference.

**Recommendations:**
- Show days-remaining inline on critical/warning lease items (e.g. "Expires in 12 days").
- Weight dispute severity by `tenantShare` dollar exposure (e.g. promote to critical
  above a configurable threshold) rather than flat "warning".
- Consider whether CAM audit risk should surface a 4th Action Center category, or
  at minimum a cross-link/footnote so users aren't misled by absence-from-the-list.

---

## 3. Property Card Information Hierarchy

**Location:** `script.js:17021-17122` (card render), `index.html:1737-1743`
(`.ptf-card-open-btn` styling).

Current top-to-bottom order: **Name (bold, 0.95rem) → Readiness badge → Status
row/trend → Insight banner (conditional) → Lease-expiry banner (conditional,
high prominence) → Stats grid (occupancy/tenants/CAM/risk) → Tenant-health
warning (conditional) → Disputes/missing-docs warning (conditional) → Review
button OR Open Property button (very low prominence, 0.62rem muted gray) → Footer**.

This is generally sound — name and readiness lead, the whole card is clickable
so the de-emphasized "Open Property" button is a deliberate, defensible choice,
and urgent banners (lease expiry, review-needed) already float near the top.

**Issues found:**
- **CAM audit risk level is buried in the stats grid**, same visual weight as
  occupancy % and tenant count — given it's the most consequential risk signal
  (drives CAM Critical/Elevated/Moderate/Low), it arguably deserves badge-level
  prominence next to the readiness badge, not grid-level.
- **Conditional banners can stack** (insight + lease-expiry + tenant-health +
  disputes) with no defined precedence — on a property with multiple issues,
  order is whatever the code happens to emit, not ranked by severity.

**Recommendations:**
- Promote CAM risk level to a badge next to (or merged with) the readiness badge
  when risk is Elevated or Critical.
- Define an explicit banner precedence (e.g. lease-expiry > disputes >
  tenant-health > insight) so the most urgent issue is always the first banner
  shown, with others collapsed into a "+2 more issues" affordance if needed.

---

## 4. Urgency Scoring

Three independent, non-numeric-comparable scoring systems currently coexist:

| System | Location | Output | Feeds |
|---|---|---|---|
| Lease expiry tiers | `acquisition-engine.js:13-23` | categorical: expired/critical/high/medium | Action Center, Renewal Pipeline |
| Portfolio impact score | `acquisition-engine.js:943-998` | numeric `impactScore` ($-weighted) | Top-3-risks panel only |
| CAM audit risk | `script.js:12101-12110` | categorical: Critical/Elevated/Moderate/Low | Property card badge, reconciliation report |

**Issue:** No single number or tier lets a user compare "is Property A or Property
B more urgent right now" across all three systems — each answers a different
question (lease timing, $ exposure, CAM audit cleanliness) and a property can
rank high on one and low on another with no reconciliation.

**Recommendation (for a future phase, not this one given the "don't touch
status-engine logic" constraint):** Define a single composite urgency tier per
property that's a deterministic function of the three existing signals (e.g.
max-of, not a new weighted average) purely for *display/sort* purposes —
without changing any of the three underlying engines. This would let the
property grid sort by "most urgent first" and let the Action Center and card
badges agree on what "critical" means. This is explicitly **not** proposed for
implementation in Phase 26.

---

## Summary — Suggested Sequencing for a Future Implementation Step

1. KPI tile reorder (cosmetic, zero risk).
2. Action Center: surface days-remaining text + dispute $ weighting (additive, low risk).
3. Property card: promote CAM risk badge, define banner precedence (additive, low risk).
4. Composite urgency tier for cross-system sort/compare (requires careful design —
   recommend its own phase with the status-engine work, not bundled here).

All four items above are recommendations only. Awaiting sign-off before any
implementation begins.
