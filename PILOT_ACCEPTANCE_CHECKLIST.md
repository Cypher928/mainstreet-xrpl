# Pilot Acceptance Checklist

The product's definition of "ready". Walk it before every release.

Walk it **as a first-time commercial property manager**, from a blank property,
in one sitting. Do not use developer knowledge. If you hesitate because you
don't know what to click next, that step **fails** — a step is not passed
because the component renders, it is passed because someone who has never seen
MainStreet could complete it.

Start from an empty account, or a brand-new property in an existing one.

---

## Getting in

The walk starts on the marketing page, signed out — the way a pilot customer
arrives. Count your clicks. There are two.

- ☐ **Log in** — tapping "Log in" on the marketing page lands you **on the sign-in form**. Not on a hero, not on a product tour, not on anything with a second "Sign in" on it.
- ☐ **Sign in** — one submit, and you are in the application.
- ☐ **Land on your properties** — the first thing on screen is the portfolio, and **＋ Add Property** is already visible. You must not have to open a property and come back for it to appear.

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
- ☐ **Archive property** — reachable from **Data Health → Property Lifecycle** without opening the Delete dialog. It removes the property from the portfolio and from every total, and keeps every lease, timeline entry, document and reconciliation. *Requires `migrations/010_property_archive.sql`.*
- ☐ **Archived properties do not move the numbers** — occupancy, WALT, revenue-at-risk, renewal counts and the dashboards are all computed as though the property were not there.
- ☐ **Restore** — the archived link under "Your properties" lists it, tapping Restore returns it to the portfolio without a page reload, the archived count decrements, and the portfolio totals include it again.
- ☐ **Delete a property created by mistake** — an empty property deletes without ceremony; one with history names what would be destroyed, recommends Archive, and requires the name typed.
- ☐ **Delete a converted property** — its acquisition returns to Ready to Convert and can be converted again.

## The Property workspace

Walk this on a building with real work on it, not the demo.

- ☐ **Add a record** — ＋ Add Record on the Property tab opens the form; every building category is there (taxes, insurance, financing, survey, site plan, building plan, environmental, capital improvement, photo, warranty).
- ☐ **Scope it to a building system** — a warranty recorded against the Roof appears in the Roof cell's count, and choosing a System clears the Space (a record has one subject).
- ☐ **Categories filter in place** — picking a category narrows the one list; it does not navigate to a different screen.
- ☐ **Related Items** — link the warranty, the invoice, the photos and the inspection to the roof job. Opening **any** of them shows the whole story, including the ones you did not start from.
- ☐ **Clicking a Building System ends the search** — "Roof" shows its records, its invoices and their total, including records linked into the job but never tagged to Roof.
- ☐ **Attach a document to an existing record** — 📎 Attach on the record. The file appears under Documents naming that record, and the record's history says who attached it.
- ☐ **Every document names its record** — no document appears without saying what it is filed on, and clicking that opens the record itself.
- ☐ **Edits preserve history** — change a record, then open "Edited N times — view history". The original values and each change are both there, with who made them.
- ☐ **A failed attachment says so** — nothing is added silently, and the record is unchanged.
- ☐ **On a phone** — the Property tab does not scroll sideways, and no record card runs past the screen.

## State integrity

- ☐ A brand-new property is completely empty — no demo data, no previous property's tenants.
- ☐ Occupancy, spaces and totals recalculate after edits.
- ☐ CAM results recalculate after leases or invoices change.
- ☐ The review queue refreshes the moment an item is resolved.
- ☐ **"What needs your attention" clears itself** — fixing the thing it names (adding a missing cap, completing lease info) removes the warning without re-entering the property.
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
| `node test-signin-walkthrough.js` | marketing page → sign-in form → signed in → portfolio → Add Property, in exactly two clicks, asserted by hit-testing |
| `node test-first-run-walkthrough.js` | create → describe → save → upload leases → review → resolve → invoices → calculate → results → statement, clicking only by visible label |
| `node test-broken-promises.js` | every control whose label promises a specific object carries an identifier for it |
| `node test-pilot-readiness.js` | edit-lease-then-Done; narrative gating; incomplete-setup guidance |
| `node test-inline-handlers.js` | every inline `onclick` compiles and calls through with a hostile value — a truncated attribute is a silently dead control |
| `node test-property-workspace.js` | add a record → scope to a system → filter → link a story → attach a document → amend with history, all through the real controls |
| `node test-property-lifecycle.js` | archive → aggregates → restore; delete with and without history; deleting a converted property reverts its acquisition |
| `node test-acq-orphan-repair.js` | the orphan backstop, including that an archived property is never reported as deleted |
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
- blocking a CDN (`cdnjs`, `jsdelivr`) inside a sandbox resets the connection
  **mid-parse**, and the browser truncates `index.html` at the failing tag — so
  `script.js` never instantiates and every global reads as `undefined`. It looks
  exactly like a top-level throw in the application. Stub the CDNs.

And one lesson that belongs to the checklist rather than the harnesses: **an
element cannot report whether something is covering it.** `getBoundingClientRect`
and `getComputedStyle` both said the sign-in form was 292×40 and `display:block`
while a marketing hero sat on top of it at `z-index:99000`. If a check is meant
to prove a control is usable, it has to go through `document.elementFromPoint` —
ask the browser what a click would actually land on.

---

Release: ______________  Walked by: ______________  Date: ______________

Every box ticked, or the release does not go.
