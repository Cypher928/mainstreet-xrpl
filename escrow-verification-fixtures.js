'use strict';

// ─── Phase 21 Verification Pack — Document Text Fixtures ────────────────────
// Plain text fixtures formatted exactly as extractPdfText() (script.js)
// produces them: each page prefixed with "--- Page N ---" so Claude can cite
// page numbers in its `evidence` response, matching the real upload pipeline.
//
// Used by test-escrow-extraction-verification.js, which drives the REAL
// Anthropic API (not a mock) against these fixtures. See
// PHASE21_VERIFICATION.md for full methodology and results.

function page(n, body) {
  return `--- Page ${n} ---\n${body.trim()}`;
}

// ── Test Set A — Clean Digital PDF ───────────────────────────────────────
// A short, well-structured reserve agreement excerpt naming three reserve
// types with explicit dollar amounts and documentation requirements.
const cleanDigital = [
  page(1, `
RESERVE AND ESCROW AGREEMENT

This Reserve and Escrow Agreement ("Agreement") is entered into between
Lakeside Commercial Lending, LLC ("Lender") and 4400 Riverside Partners LLC
("Borrower") in connection with the loan secured by 4400 Riverside Drive.

ARTICLE 3 — RESERVE ACCOUNTS

3.1 Roof Reserve Account. Lender shall maintain a Roof Reserve Account
("Roof Reserve") with a balance of $75,000.00 as of the Closing Date. Funds
in the Roof Reserve may be used solely for roof repair and replacement at
the Property.

To request a disbursement from the Roof Reserve, Borrower shall submit to
Lender: (a) paid or unpaid contractor invoices; (b) before-and-after
photographs of the completed work; and (c) executed lien waivers from each
contractor and subcontractor performing the work. No disbursement shall be
made absent all three items.
`),
  page(2, `
3.2 HVAC Reserve Account. A separate HVAC Reserve Account is established
with an initial balance of $40,000.00, to be used exclusively for repair or
replacement of heating, ventilation, and air conditioning equipment serving
the Property. Disbursement requests require submission of contractor
invoices and, for any single disbursement exceeding $10,000.00, a bid from
no fewer than two licensed HVAC contractors.

3.3 Capital Reserve Account. Borrower shall fund a Capital Reserve Account
at $150,000.00 for general capital expenditures at the Property as approved
by Lender in its reasonable discretion. No minimum draw amount applies.

3.4 Draw Requests Generally. All draw requests under this Article 3 must be
submitted no later than the 15th day of each calendar quarter, and Lender's
written approval is required before any disbursement is released.
`),
  page(3, `
ARTICLE 4 — RESERVE EXPIRATION

4.1 Unless extended by Lender in writing, all reserve accounts described in
Article 3 shall expire and any unused balance shall be released to Borrower
on December 31, 2027.

4.2 Completion Deadline. All repair or capital improvement work funded from
a reserve account must be substantially completed within 180 days of the
date the related disbursement is approved.

[Signature page follows]
`),
].join('\n\n');

// ── Test Set C — Messy Legal Language ────────────────────────────────────
// A 25-page mortgage/loan agreement where the reserve clauses are buried in
// the middle (pages 17-19), surrounded by unrelated boilerplate covenants,
// definitions, and events-of-default language — the scenario most likely to
// expose truncation bugs in extraction (a naive head+tail window would never
// reach page 17).
function boilerplatePage(n, topic) {
  return page(n, `
SECTION ${n}. ${topic.toUpperCase()}

The parties acknowledge and agree that the provisions of this Section ${n}
shall survive the termination of this Agreement. Borrower represents and
warrants that, as of the date hereof, no Event of Default has occurred and
is continuing under any Loan Document. Lender's failure to exercise any
right or remedy hereunder shall not constitute a waiver of such right or
remedy on any future occasion. Capitalized terms used in this Section ${n}
and not otherwise defined shall have the meanings ascribed to them in
Section 1 (Definitions) of this Agreement. This is boilerplate language
unrelated to reserve accounts, included to simulate a realistic document
length and to test whether reserve-specific clauses elsewhere in the
document are still located and extracted correctly.
`);
}

const messyMortgagePages = [];
// 22 generic, non-reserve topics — fills all pages except the buried reserve
// clause on pages 17-19, in document order.
const topics = [
  'Recitals', 'Definitions', 'The Loan', 'Conditions Precedent', 'Representations and Warranties',
  'Affirmative Covenants', 'Negative Covenants', 'Financial Covenants', 'Insurance Requirements',
  'Casualty and Condemnation', 'Leasing Covenants', 'Transfer Restrictions', 'Subordinate Financing',
  'Management of the Property', 'Books and Records', 'Inspections',
  // pages 17-19 are the reserve clause, inserted below
  'Events of Default', 'Remedies', 'Indemnification', 'Environmental Matters',
  'Single-Purpose Entity Covenants', 'Yield Maintenance',
];
let topicIdx = 0;
for (let i = 1; i <= 16; i++) messyMortgagePages.push(boilerplatePage(i, topics[topicIdx++]));

messyMortgagePages.push(page(17, `
SECTION 17. REPAIR RESERVE

Concurrently with the closing of the Loan, Borrower has deposited with
Lender the sum of $62,500.00 (the "Repair Reserve"), to be held by Lender
as additional security for the Loan. The Repair Reserve shall be disbursed
only for roof and structural repairs identified in the Property Condition
Report dated as of the Closing Date, and only upon Lender's receipt of:
(i) itemized contractor invoices, and (ii) conditional or unconditional
lien waivers, as applicable, from each contractor performing the work.
`));
messyMortgagePages.push(page(18, `
SECTION 17. REPAIR RESERVE (continued)

Borrower shall not be entitled to any disbursement from the Repair Reserve
in an amount less than $2,500.00 per request. All repair work funded from
the Repair Reserve must be completed in full no later than March 1, 2027
(the "Repair Completion Deadline"), and Borrower shall submit each request
for disbursement no later than the last business day of each calendar
month (the "Draw Request Deadline"). Any undisbursed balance remaining in
the Repair Reserve as of June 30, 2027 (the "Reserve Expiration Date")
shall, at Lender's election, be applied to the outstanding principal
balance of the Loan or returned to Borrower.
`));
messyMortgagePages.push(page(19, `
SECTION 17. REPAIR RESERVE (continued)

No disbursement from the Repair Reserve shall require engineer
certification unless the cost of the applicable repair exceeds
$25,000.00, in which case Borrower shall additionally provide a
certification from a licensed structural engineer confirming the work has
been completed in accordance with the Property Condition Report.
`));
for (let i = 20; i <= 25; i++) messyMortgagePages.push(boilerplatePage(i, topics[topicIdx++]));

const messyMortgage = messyMortgagePages.join('\n\n');

module.exports = { cleanDigital, messyMortgage };
