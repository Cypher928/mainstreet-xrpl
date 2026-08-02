# Pilot Acceptance Checklist

The product's definition of "ready". Walk it before every release.

Walk it **as a first-time commercial property manager**, from a blank property,
in one sitting. Do not use developer knowledge. If you hesitate because you
don't know what to click next, that step **fails** — a step is not passed
because the component renders, it is passed because someone who has never seen
MainStreet could complete it.

Start from an empty account, or a brand-new property in an existing one.

---

## The workflow

- ☐ **Create property** — a visible way to create one exists from the portfolio, and clicking it lands you where the property is described (not on a tab with nothing to do).
- ☐ **Enter property information** — name and total square footage are on the screen you land on.
- ☐ **Save property** — an explicit Save exists, tells you it worked, and hands you to the next step. It must not throw you back to the portfolio.
- ☐ **Upload lease** — a drop zone is reachable and visible without hunting for a tab.
- ☐ **AI extraction completes** — the lease comes back as a tenant with terms, not as a filename.
- ☐ **Review updates** — leases the AI could not fully read are flagged, and the screen you are on says which lease and which field.
- ☐ **Resolve a review item** — the flagged lease opens **that** lease, the missing field is stated on the record, and pressing Done clears the warning, refreshes the queue, and confirms the save.
- ☐ **Upload invoices** — reachable, with the next step stated.
- ☐ **Calculate CAM** — the confirmation names the amount and tenant count before running.
- ☐ **Review allocations** — results list every tenant with their share.
- ☐ **Generate tenant statement** — opens a statement for **one named tenant**, with their own percentage.
- ☐ **Dashboard alerts deep-link correctly** — every card, CTA and review action opens the specific object it names, or says why it cannot.
- ☐ **Archive property** — *not implemented. Leave unchecked until Property Lifecycle ships.*

## State integrity

- ☐ A brand-new property is completely empty — no demo data, no previous property's tenants.
- ☐ Occupancy, spaces and totals recalculate after edits.
- ☐ CAM results recalculate after leases or invoices change.
- ☐ The review queue refreshes the moment an item is resolved.
- ☐ The AI Auditor Narrative does not appear until a reconciliation has run.
- ☐ An incomplete property produces setup guidance naming what is missing and where — never a silent no-op or a raw failure.

## Never acceptable

- ☐ No dead ends — every screen states the next step.
- ☐ No misleading buttons — a label that names an object must open that object.
- ☐ No orphaned UI — nothing rendered into a pane the user cannot reach.
- ☐ No stale copy — no references to tabs or sections that no longer exist.
- ☐ The step indicator is visible on every tab.

---

## What the automated suites already cover

Run these first; they are fast and catch regressions in the paths below.

| Suite | Covers |
|---|---|
| `node test-first-run-walkthrough.js` | create → describe → save → upload leases → review → resolve → invoices → calculate → results → statement, clicking only by visible label |
| `node test-broken-promises.js` | every control whose label promises a specific object carries an identifier for it |
| `node test-pilot-readiness.js` | edit-lease-then-Done; narrative gating; incomplete-setup guidance |
| `node test-regression.js` | 182 engine/allocation/persistence checks |

**Green suites are not a passed checklist.** They exercise the paths that were
broken before; they cannot tell you a new screen is confusing.

## What they do NOT cover

- **Live AI extraction.** The suites run against seeded post-extraction state.
  `test-live-extraction-walk.js` drives a real PDF through the real client
  pipeline and the real `api/claude.js`, but completing it needs
  `ANTHROPIC_API_KEY`, a valid Supabase session, and network access to
  `*.supabase.co` — so it must be run against a Preview deployment or a machine
  holding those credentials, not from a sandbox. **The "AI extraction completes"
  box is only ticked by a genuine live run.**
- **Anything on a real device.** Mobile layout and touch targets are not walked.
- **Real user data volumes.** Every walk uses 3–4 tenants and 2–4 invoices.

## A warning about the harnesses

Every false alarm below was produced by a test, not the product, and each cost a
debugging cycle. When a harness says something is missing, confirm it is missing
*for a user* before filing it:

- the bulk upload panel does not use `.upload-zone`
- the Run button is labelled **"Calculate CAM Charges"**, not "Run CAM"
- `#wsPane-property` is built at runtime by `property-os.js`; grepping the HTML finds nothing
- `switchWorkspaceTab()` does not re-show `#mainWorkflow`, so switching tabs from the portfolio leaves you on the portfolio
- `/NaN/i` matches the "nan" in "tenant"

---

Release: ______________  Walked by: ______________  Date: ______________

Every box ticked, or the release does not go.
