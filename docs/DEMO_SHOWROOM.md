# The showroom — Cascade Commons with its cabinet populated

Seed version 8 of the demo property (`ensureDemoProperty`, `script.js`) fills
the Property tab's filing cabinet with the building's own records, so the first
thing a visitor opens reads like a well-kept building rather than a set of
empty drawers. This document says what is seeded, where it lives, what is a
record and what is not, and how to rebuild the documents.

## What is seeded, and where it appears

Every record is an ordinary **manual timeline event** — `manual: true`, a
`category` (which is what files it in a drawer), a `subject` (the property or
one of its building systems), an author, an absolute date — exactly the shape
`appendPropertyTimelineEvent()` writes. There is no new record type and no new
store. Ids are `demo-rec-<slug>`; the function is `demoCabinetRecords()`.

| Drawer | Records | Story |
|---|---|---|
| Real Estate Taxes | 9 | 2023–2025 appraisal notices and bills, the 2024 protest, the 2024 receipt, the 2026 notice with its protest settled and the bill due **January 31, 2027** (key date) |
| Insurance | 4 | 2024–25 and 2025–26 renewals of the Travelers policy **TRV-CP-8843017-25** expiring 2026-09-30 (the same number and date as Property information), the lender's certificate, the May 2024 hail claim |
| Mortgage & Financing | 4 | the 2019 acquisition loan from a **fictional** lender (Pecan Valley Commercial Capital, LLC) maturing **November 1, 2029** (key date), the 2022 rate amendment, the 2025 escrow analysis, 2026 lender reporting |
| Property Financials | 5 | 2024 CAM close-out, 2025 budget ($181,500 against the register's $188,300 actual), two 2026 owner distributions, the 2026 draft budget |
| Agreements | 5 | management, landscaping, HVAC maintenance, security and janitorial agreements — each linked to that vendor's invoices on the register; management renews **2026-12-31**, HVAC **2027-03-31** (key dates) |
| Building & Systems | 17 | Roof (2019 replacement, 20-year warranty expiring **2039-08-30**, 2024 hail inspection, 2025 repair), HVAC (RTU-5/6 replaced 2024, spring and fall PM, the November emergency repair), Parking (2019 restripe, the April 2025 seal coat FitZone disputed), Fire (2025 inspection, next due **2026-10-20**), Landscaping, Electrical (LED retrofit, signage service), Plumbing (backflow test, next **2027-02-15**), two building illustrations |
| History | 5 | built 2003, acquired and renovated 2019, Whole Health Market opened 2021, Harbor Nail opened 2024 — records with no other home, filed by fallback |

Links use `relatedTo` by the register's **stable invoice id**. v8 gives the
register's 26 rows the ids `inv-0…inv-25` that the reconciliation summary and
the three disputes already used, so a dispute's `invoiceId`, a record's link
and a variance row all resolve to one row. The Roof, HVAC and Parking stories
reach their bills through those links (`PropertyOS.systemStory`).

Seven records carry a `keyDate` + `keyDateKind`; `PropertyCabinet.importantDates`
derives them into Important Dates beside the lease ends and the insurance
expiry, each pointing at its record.

## What is NOT a record

- **Reference samples** (`PropertyReference.demoPropertyDocuments`: site plan,
  survey, shell plans, Phase I, the policy PDF, roof warranty, striping plan,
  LED scope, two photos) remain samples. They sit in the closed "Reference
  samples — not records on this property (demo only)" box under Building &
  Systems, every row tagged *sample*, and are never counted or filed.
- **The header image** is `info.imageUrl` on the demo's `PropertyReference.demoInfo`
  — `assets/demo/cascade-commons-rendering.svg`, an architectural rendering
  captioned "demonstration illustration, not a photograph", with the same words
  drawn on the image. No image model was added; a real property shows an image
  only if its own `info` carries one.

## The documents

Twelve PDFs under `assets/demo/records/`, each headed **"Cascade Commons —
Demonstration Document — Fictional"** on its first line and footed with the
same, plus two SVG illustrations. They are attached to their records as
ordinary `attachments` (`{ name, url, kind }`) and render through the app's one
document path, `docLinkHtml` — as static files they are plain links, not
storage references, so nothing signs them and no second document system
exists.

Rebuild them with:

```
node tools/build-demo-records.js          # Chromium print pipeline → text-layer PDFs
node tools/build-demo-records.js --check  # exit 1 if any is missing
```

Every name, amount, account number and signature in them is invented. The
fictional lender is the one place a real institution would otherwise have been
attached to invented loan terms; it is not.

## v9 — the invoice register carries its source documents

Until v9 the register was 26 rows of vendor, amount, category and date with no
document behind any of them, and the product's own audit said so:

> **26 of 26 invoices missing source document** — property-wide, red,
> 0 of 5 tenants billable

That refusal was correct, and none of the machinery that produces it changed.
What changed is that the documents now exist. `tools/build-demo-invoices.js`
renders one PDF per row to `assets/demo/invoices/`, and the seed attaches them:

```
node tools/build-demo-invoices.js          # → assets/demo/invoices/invoice-cc-2025-NNNN.pdf
node tools/build-demo-invoices.js --check  # exit 1 if any is missing
```

**The register is not copied into the tool.** Every vendor, amount, category
and date is parsed out of `demoInvoiceList` in `script.js` at build time, and
the tool refuses to write anything if the parse does not yield the 26 rows the
seed holds. **The index is the identity**: row `i` is documented by the `i`-th
file, the same index that gives the row its `inv-<i>` id, so a document cannot
come to sit against the wrong bill. `_demoInvoiceUrl()` and
`_demoInvoiceFileName()` in `script.js` are the one place that mapping is
spelled, and both the register the CAM screen renders and the
`invoicesFull` array `buildAuditSummary()` reads are built from it —
they used to be able to disagree.

What this does and does not change:

| | Before | After |
|---|---|---|
| Missing-document finding | red, property-wide | not raised; a green finding records the documents |
| Tenants billable | 0 of 5 | 3 of 5 |
| Whole Health Market | blocked · property | **billable**, $34,650.00 |
| Summit Coffee & Provisions | blocked · property | needs confirmation — a parking exclusion the matcher could not apply |
| ProActive Physical Therapy | blocked · property | **still held** — Modified Gross lease, CAM treatment unconfirmed |
| Property verdict | Not ready to bill | Not ready to bill — one tenant, others unaffected |
| Every allocated amount | — | **unchanged** |

ProActive stays held deliberately. A Modified Gross lease may or may not permit
CAM pass-throughs and the engine will not assert which without a human reading
the lease (`reconciliation-engine.js`, the Gross/Modified Gross detector,
`blocksBilling: true` on a yellow finding). Its classification was not touched.

Attaching evidence changes what the audit can verify, not what anyone owes:
the tenant allocation stays $88,776.77 and the cap reductions stay $75,548.60.
`test-e2e-invoice-evidence-identity.js` asserts both figures twice — once with
the documents and once with them stripped back out.

Documents are checked against the register from the other end by
`test-demo-invoices.js` (in the regression as *Demo invoice document
contract*): same 26 things in the same order, each document stating its own
row's vendor, amount, date and category, none naming another row's invoice
number, every one marked fictional, and nothing borrowed from Northgate
Exchange — that property has its own register, vendors and Boise address.

## Verification

`test-e2e-demo-showroom.js` (in the regression as *Demo showroom — populated
cabinet*) loads the demo through the real path with a Supabase stand-in that
survives a reload and checks: each record is shown in its intended drawer and
no other; no duplicates; no future-dated record, no key date before its record,
the policy record agrees with Property information; agreement records link
only their vendor's bills; the HVAC story is ComfortFirst's three bills and
the Parking story the PavePro bill; Important Dates are derived from the stored
row, and a key date written through `appendPropertyTimelineEvent` on a real
property survives save → reload; every attachment is served, is a text-layer
PDF headed with the banner (or a labelled illustration), and renders as a
plain link; the header image and caption say demonstration / not a photograph
and a real property gets none; the samples box is closed, tagged, after the
records and never counted. `tools/demo-showroom-mutation.js` breaks the seed,
the writer and the image one decision at a time to prove the suite looks.

## A demo that already existed

`ensureDemoProperty()` used to run only from `loadDemo()` — the "Open Demo"
card and the "Try Live Demo" button. Once the demo row exists it is also an
ordinary card in the portfolio, and that card (like the global search and every
attention link) calls `selectProperty` directly, so an account that had Cascade
Commons before a seed bump opened it as whatever version last seeded it: the
v8 records never arrived and the drawers read "Nothing filed yet". That is
what the first deployed showroom showed.

Now `selectProperty(DEMO_PROPERTY_ID)` runs the seed first. The seed is
idempotent — one read when the row is at the current version — so this costs
nothing until the seed itself changes, and then it runs once. For that to hold,
the version marker has to survive an ordinary save: the seeded live object now
carries `_demoV`/`_demoVersion`, `loadPropertyData` reads them from the row and
`selectProperty` applies them, so the save payload (which copies them from the
live object) keeps the row at its version. A note a manager adds to the demo
therefore survives a reload; before, the first save dropped the marker and the
next open re-seeded the demo over it. Section 10 of the showroom suite is
exactly this account: a stored v7 row plus its localStorage copy, opened from
the card, written to, reloaded, opened again — seeded once, never again.

## One thing found and not changed

- **Invoice relations do not persist.** `_stripBlobs` does not keep `system`
  or `spaceId` on an invoice, so a Space/System relation set in the register is
  lost on reload. The demo links bills from the record side (`relatedTo`,
  persisted) rather than tagging invoices. Pre-existing.
