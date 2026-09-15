# Northgate Exchange — the demo property MainStreet can bill

Cascade Commons demonstrates that MainStreet knows when **not** to bill. None
of its twenty-six invoices carries a source document, so a red property-wide
finding holds every statement, and one Modified Gross tenant is held on top of
that. That is deliberate and it stays exactly as it is.

Northgate Exchange is the other half of the same claim: a property whose
evidence and lease terms genuinely support billing. It is not engineered around
the safeguards. It satisfies them.

## The property

| | |
|---|---|
| Building | 24,000 rentable sqft, CAM year 2025 |
| Leases | 5, all NNN, 20,100 sqft, 83.75% of the building |
| Vacancy | Suite 150, 3,900 sqft, 16.25%, recorded vacant |
| Invoices | 16, $107,900, $4.50 per sqft |
| Billed | $84,882.25 across five tenants |
| Verdict | Bill with review — no red findings, no blockers |

Spaces:

| Suite | Tenant | Sqft | Share | Term | Cap | Prior-year base |
|---|---|---|---|---|---|---|
| 100 | Ridgeline Outfitters | 8,400 | 35.00% | 2020-06-01 → 2030-05-31 | 5% | $33,400 |
| 110 | Corner Post Café | 2,100 | 8.75% | 2022-09-01 → 2027-08-31 | none | — |
| 120 | Northgate Family Dental | 3,600 | 15.00% | 2021-04-01 → 2029-03-31 | 4% | $14,900 |
| 130 | Bright Lane Cleaners | 1,800 | 7.50% | 2023-01-01 → 2028-12-31 | none | — |
| 140 | Lakeside Veterinary Clinic | 4,200 | 17.50% | 2022-03-01 → 2027-02-28 | 6% | $18,200 |
| 150 | *(vacant)* | 3,900 | 16.25% | — | — | — |

Corner Post Café's lease excludes **management** from CAM, so its share is
struck from a pool with the four management invoices removed. That is $2,100
less than it would otherwise pay, and the audit says so.

## What it demonstrates, and why each part is there

- **Calculate succeeds and every tenant is billed.** Five allocations, all
  positive, from the live engine. Re-running produces the seeded figures
  exactly.
- **Cap enforcement is visible without being a trick.** Three leases carry a
  cap over a stated prior-year base. Ridgeline's bites for $2,695 and the
  dental practice's for $689. Lakeside's does not: the year lands inside its
  ceiling, so the cap reads as a limit that was respected rather than a
  discount that was applied.
- **Coverage is green rather than merely quiet.** The leases cover 83.75% and
  Suite 150 accounts for the rest, so the coverage finding reads "83.8%
  documented · 16.3% confirmed vacant" instead of leaving a remainder
  unresolved.
- **The pool is substantiated.** Every register line has its own generated
  invoice PDF, which is what the 100%-missing-source-document finding fires on
  when it is absent.
- **Nothing states a provision the engine does not apply.** No admin fee, no
  expense stop, no gross-up, no base year, no pro-rata method. Each of those
  raises a blocking "lease provisions not applied" finding by design, and the
  leases are silent on them because the documents are too.

## Where the numbers live

`demo-northgate.js` states them once. Three readers share it:

- the seeder, `ensureNorthgateDemo()` in `script.js`;
- the document generator, `tools/build-demo-northgate.js`;
- the consistency test, `test-demo-northgate.js`.

So the seeded records and the paperwork cannot drift apart. The generator
renders five lease PDFs and sixteen invoice PDFs into
`assets/demo/northgate/` through Chromium's print pipeline, which emits a real
text layer — the Evidence Viewer locates a cited quote inside that layer, and a
picture of a page would silently fail to highlight. Every document is headed
"Northgate Exchange — Demonstration Document — Fictional" and every party,
vendor and signature is invented.

**No `fieldEvidence` is seeded**, exactly as on Cascade. A citation is produced
by running a document through extraction; seeding one would be fabrication, and
a quote the PDF does not contain cannot be made to highlight.

## Identity and idempotency

The property has its own id prefix (`ne000000-…`, derived per user like
Cascade's) and its own version marker, `_ngV`. A stored row already at the
current version is left alone, so opening the property repeatedly, or reloading
after editing it, never re-seeds over what is there. The marker travels on the
live object as well as the stored row, so an ordinary save cannot strip it. The
denormalised `tenants` table receives the five leases only: the vacant row is a
space, not a tenant.

## Reaching the demos from a portfolio that is not empty

Every route into `loadDemo()` used to sit inside the zero-properties branch of
`renderPortfolio`: the "Open Demo" cards, the "Try Live Demo" button, and the
welcome panel, which `_maybeShowWelcome` dismisses permanently as soon as a real
property exists. So an account that had added one property of its own could not
reach either CAM demo at all. Measured on the pilot preview: a manager with one
property had no control anywhere in the product that would seed or open them,
and the only way in was the browser console. The seeders were correct. They were
unreachable.

The invitation is now offered beside the manager's own cards, and it stays
**opt-in**:

- `_renderDemoPropertiesSection()` renders the same three cards the empty state
  renders, calling the same entry points. Nothing is seeded until a card is
  clicked.
- It is suppressed once `_demoPropertiesSeeded()` is true, so the invitation
  withdraws rather than duplicating cards that are already there, and while a
  search is active, because the demo cards are not search results.
- `_isDemoPropertyId()` is the one predicate three surfaces share: whether to
  offer the invitation, whether a card is badged `DEMO`, and whether opening a
  card re-checks its seed. A seeded demo therefore also stops counting as a real
  property for the welcome panel, which is what it always meant to do.
- Either CAM card seeds both properties, because the pair is the demonstration:
  Northgate bills and Cascade refuses, and the second is what makes the first
  mean anything. `loadDemo()` opens Cascade, `_openNorthgateDemo()` opens
  Northgate, and both seeders are idempotent.

Once seeded they are ordinary portfolio cards carrying a `DEMO` badge, so they
cannot be mistaken for the manager's own buildings. `test-e2e-demo-discoverability.js`
pins all of it, including that arriving at the portfolio seeds nothing.

## Verification

`test-demo-northgate.js` checks that the leases plus the vacancy account for
the building exactly, that no lease can block billing, that the caps are real
and one of them does not bite, that the register is clean and the exclusion
actually changes a number — and then reads all twenty-one PDFs back and fails
if any term drifts from the seed.

`test-e2e-northgate-billable.js` walks the whole lifecycle on the real page:
portfolio, open, Spaces with the vacancy, documents fetched over HTTP, Prepare,
Calculate, allocations, caps, exclusion, green coverage, a billable verdict with
no blocker, reload, and re-seeding twice with nothing duplicated.

It ends with the part that matters. Strip the source documents and the same
property refuses with exactly the finding that holds Cascade, while the
arithmetic stays identical — the refusal is about evidence, not about the
numbers. Make one lease Modified Gross and that tenant alone is held while the
other four still bill. Northgate is billable because it satisfies the gates,
and the test proves it by removing what satisfies them.
