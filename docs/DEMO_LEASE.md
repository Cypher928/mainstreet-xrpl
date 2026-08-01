# Demo Lease — Whole Health Market

The demo property claims a 5% CAM cap and enforces **−$31,979.23** against it.
Until now it could not prove that: no demo tenant had a lease document, so the
Evidence Viewer had nothing to cite. This document closes that gap with a real
lease rather than seeded evidence.

## What was created

| File | Purpose |
|---|---|
| `assets/demo/lease-whole-health-market.html` | The lease, authored as markup |
| `assets/demo/lease-whole-health-market.pdf` | Rendered PDF — 3 pages, 42 KB, real text layer |
| `tools/build-demo-lease.js` | Renders HTML → PDF (reproducible) |
| `test-demo-lease.js` | Proves the document is citable |

The lease is a realistic retail lease: basic lease provisions, term, rent, an
Article 6 on Common Area Maintenance, and Article 7 audit rights. It contains
only what the existing extraction fields need — no invented clauses padding it
out.

## Internal consistency with Cascade Commons

Every value the demo tenant config asserts appears verbatim in the document, and
`test-demo-lease.js` fails if any one of them drifts:

| Demo config | Lease |
|---|---|
| `leased_sqft: 9200` | "approximately **9,200 rentable square feet**" (§1.1) |
| building 26,000 sf | "approximately **26,000 rentable square feet**" (§1.2) |
| pro-rata 35.38% | "**35.38%**" (§1.3) |
| `cap: 5` | "shall not increase by more than **five percent (5%)**" (§6.4) |
| `capBaseAmount: 33000` | "**Thirty-Three Thousand and 00/100 Dollars ($33,000.00)**" (§6.5) |
| `start_date: 2021-01-01` | "**January 1, 2021**" (§1.4) |
| `end_date: 2028-12-31` | "**December 31, 2028**" (§1.5) |
| `lease_type: NNN` | "**Triple Net (NNN)**" (§1.6) |
| `audit_rights: 90 days` | "**ninety (90) days after Tenant's receipt**" (§7.1) |
| `excluded_categories: ''` | "no category … is excluded" (§6.6) |

## Why the document must carry a text layer

The Evidence Viewer's tier 3 (`evidence-viewer.js`, `locateQuoteInItems`) finds
the cited quote **inside the PDF's own text layer** and draws the highlight over
the matching runs. A scanned or image-only PDF has no text layer, so the
highlight silently fails and the viewer honestly reports that it "couldn't
automatically identify the paragraph."

This also means **a fabricated quote cannot be made to highlight.** If a citation
quotes language the document does not contain, tier 3 finds nothing and says so.
The viewer is self-verifying, which is exactly why seeding a quote would have
been worse than useless.

`tools/build-demo-lease.js` renders through Chromium's print pipeline, which
embeds ToUnicode CMaps — so PDF.js recovers real characters.

## Verified

`node test-demo-lease.js` — 16 checks, all passing:

- PDF opens with **the same PDF.js the app uses**, 3 pages, 4,879 characters of
  recoverable text
- all ten asserted terms present
- **the cap clause is located on page 2, exact match, by the viewer's own
  matching logic** — mirrored into the test from `evidence-viewer.js` so the two
  cannot drift apart silently
- the demo tenant config seeds **no** `fieldEvidence`
- the demo tenant points at the real document

Live in a browser, the attached document fetches `200 application/pdf`, 42,669
bytes.

### A correction worth recording

The first version of the build tool verified the text layer by inflating the
PDF's content streams and reading the `Tj` operands. It reported **every clause
missing** on a perfectly good PDF. The cause: Chromium embeds subset
`CIDFontType2` fonts, so those operands are glyph indices, not characters. The
tool was wrong, not the document. Verification now runs through PDF.js, which
reads the ToUnicode CMaps properly.

## What is deliberately NOT done

**No evidence is seeded.** `fieldEvidence` stays empty in the demo config. The
`leaseUrl` attaches the *document*; it does not assert what the document says.
Citations must be produced by extraction, or they are not evidence.

Consequently, right now:

```
tenant.fieldEvidence                    → {}
EvidenceViewer.fromTenantField(…'cap')  → null
```

That is the correct state. It becomes a citation only after ingestion runs.

## The remaining step — running ingestion

Field extraction calls Claude through `api/claude.js` / `api/validate-lease.js`.
**This environment cannot make that call:** outbound HTTPS is blocked by the
network policy (the proxy returns 403 on CONNECT), so the extraction step has
not been run here.

Run it where the API key lives — the pilot:

1. Open the pilot, load the demo property.
2. Upload `assets/demo/lease-whole-health-market.pdf` against **Whole Health
   Market** through the normal lease upload flow.
3. Let extraction complete. It should return `cam_cap: 5` and a `quotes.cam_cap`
   carrying the §6.4 language — the system prompt explicitly instructs the model
   to search for "not to exceed", "capped at", "increases limited to" and
   related phrasing, all of which appear in §6.4.
4. Extraction writes `fieldEvidence.cap.snapshots[]` through the existing
   `_appendEvidenceSnapshot` path. Nothing is hand-written.

### Then verify the four acceptance criteria

| Criterion | How to check |
|---|---|
| Viewer opens the correct document | Open the cap field's evidence → title reads the Whole Health Market lease |
| Highlight comes from real extracted evidence | The clause highlights **without** the "couldn't identify the paragraph" banner |
| Citation references the actual page and text | Side panel shows **Page 2** and the §6.4 language verbatim |
| The cap is supported by the lease | Reconciliation shows `−$31,979.23`; the citation shows the 5% clause that produces it |

Page 2 is the expected page, confirmed by the test.

## Known minor gap

`leaseFileName` does not survive the demo tenant normaliser — only `leaseUrl`
does — so the Evidence Viewer title falls back to the source label rather than
showing the file name. Cosmetic, does not affect citation resolution or
highlighting. Worth a one-line passthrough if the title matters.
