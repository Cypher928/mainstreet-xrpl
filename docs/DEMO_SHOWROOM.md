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

## Two things found and not changed

- **The demo re-seeds after any save.** The in-memory demo object never
  carries `_demoV`; an app save writes the row without it; the next load fails
  the idempotency check and re-seeds. A record a user adds to Cascade Commons
  does not survive a reload (real properties are unaffected). Pre-existing;
  the key-date persistence proof therefore runs on a non-demo property.
- **Invoice relations do not persist.** `_stripBlobs` does not keep `system`
  or `spaceId` on an invoice, so a Space/System relation set in the register is
  lost on reload. The demo links bills from the record side (`relatedTo`,
  persisted) rather than tagging invoices. Pre-existing.
