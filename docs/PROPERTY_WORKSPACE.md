# Property Workspace

**Status:** agreed direction, not started. Begins once the Property Lifecycle
walkthrough passes.

The Space workspace made a suite the operational record for a tenancy. This does
the same for the building itself — and reuses that implementation rather than
growing a second one beside it.

---

## The rule that governs everything else

**No parallel data stores.** A property activity is a property-scoped timeline
event, full stop. The Property Timeline stays the single verified history for
the building, exactly as `TenantSpace` records are the single history for a
suite.

This is not a preference about tidiness. Every category below is a *filter over
one timeline*, not a screen with its own storage. The moment "Insurance" gets
its own array, three things follow that have already cost us time elsewhere: the
timeline stops being complete, two places disagree about what happened, and a
reconciliation or property switch clears one of them and not the other.

*Violation shape:* a new `prop.insurance = []`, `prop.taxes = []`, or a category
that renders from anything except the timeline.

## Categories

Categories are a **filter**, not separate screens — one Property Records surface
with a category selector, the same shape as the Space workspace's Add Activity.

- Real Estate Taxes
- Insurance
- Mortgage / Financing
- Surveys
- Site Plans
- Building Plans
- Environmental Reports
- Capital Improvements
- Building Photos
- Warranties — tied to building systems where appropriate

Two of these carry existing work that must be reused, not re-implemented:

- **Mortgage / Financing** overlaps the escrow/reserve engine
  (`escrow-reserve-engine.js`, `escrow-draw-packets.js`), which already extracts
  and cites mortgage terms. Financing records should surface those, not
  re-extract them.
- **Warranties** were deliberately removed from the Space activity types during
  the pilot freeze, on the grounds that a warranty belongs to the building
  system rather than the tenancy. This is where they come back — attached to a
  building system, not floating in a category.

## What carries over from Spaces, unchanged

Settled patterns. Reuse them; do not re-decide them.

- **`➕ Add Activity` as the centrepiece**, with a type picker and a form per
  type. Every submission creates a timeline event and files its attachments into
  the right section automatically.
- **Append-only revisions.** Records are amended, never mutated in place;
  `event.revisions[]` keeps the original and the history of how it evolved.
  (ARCHITECTURE_PRINCIPLES §6.)
- **Provenance on every record** — who created it and when.
- **Related Items**, so a roof repair is one thing rather than six.
- **Empty states that say what to record**, not blank panels.

## Open questions — to answer before building, not during

1. **Where does a property record live in storage?** Spaces keep records on the
   tenant subject. The property timeline already exists
   (`property-timeline.js`); the question is whether a property activity is a
   timeline event with a category field, or a subject-scoped record that emits
   one. The first is simpler and is the default unless something argues against
   it.
2. **Do categories need per-category fields?** Taxes have an assessment year and
   amount; a site plan has a revision date and little else. Either one form with
   optional fields, or a per-category form like the Space activity types. The
   Space pattern already solved this; follow it.
3. **What does an archived property's workspace show?** It must stay readable —
   archiving preserves history, and history you cannot open is not preserved.
4. **Does a property record ever become evidence?** Spaces gate "Draft from this
   record" on real activity. The equivalent question here is whether an
   environmental report or survey can be cited in a reconciliation, and if so,
   through the same Evidence Viewer path.

## Acceptance, when it is built

Walked as a property manager, not asserted from component tests.

- ☐ Every category is reachable from one Property Records surface via a filter,
      not by navigating to a different screen.
- ☐ Adding a record of any category produces a **property timeline event**, and
      the timeline shows it.
- ☐ No category renders from a store other than the timeline. *(The regression
      test is the point of this line — a violation is invisible on screen.)*
- ☐ Amending a record preserves the original and shows the revision history.
- ☐ Every record names who created it and when.
- ☐ A warranty attaches to a building system, and that system's records are
      findable from it.
- ☐ An archived property's records and timeline are still readable.
- ☐ Empty categories say what to record there, and why.
