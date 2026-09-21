'use strict';
/**
 * _claude-tasks.js — SEC-2: extraction instructions are the server's.
 *
 * The sibling fix (AI-2, api/_explain-tasks.js) moved /api/explain's prompts
 * server-side and this endpoint was left behind — with the identical defect on
 * the more important path. /api/claude is LEASE EXTRACTION. Its system prompt
 * defines the canonical field schema: what counts as a CAM cap, how sqft is
 * parsed, when a value may be null, which entity is the tenant. All of it
 * travelled from the browser and was forwarded to Anthropic verbatim by
 * `if (system) payload.system = system;`.
 *
 * That means every extraction guarantee was rewritable by the caller, and the
 * output flows into fieldEvidence snapshots the Evidence Viewer presents as
 * provenance. A prompt the caller controls cannot support a provenance claim.
 *
 * Same contract as _explain-tasks.js: the client names a TASK, the server
 * decides what the model is told, a client-supplied `system` is REFUSED rather
 * than ignored, and there is no fallback for an unrecognised name. The caller
 * still supplies `messages` — the lease text and the page images are its data;
 * the instructions are ours.
 */

const { UNTRUSTED_DOCUMENT_RULE } = require('./_untrusted-text');

// ── Commercial lease field extraction ───────────────────────────────────────
// Moved verbatim from script.js CLAUDE_LEASE_SYSTEM.
const LEASE_EXTRACTION_SYSTEM = `You are a strict JSON extraction engine for commercial leases.
Return ONLY valid JSON. No text. No explanation. No markdown. Start with { and end with }.

Return exactly this structure:
{
  "tenant_name": string,
  "suite": string | null,
  "lease_start_date": "YYYY-MM-DD",
  "lease_end_date": "YYYY-MM-DD",
  "lease_type": string,
  "sqft": number,
  "base_rent": number | null,
  "cam_cap": number,
  "admin_fee_pct": number | null,
  "admin_fee_basis": "operating_expenses" | "controllable_expenses" | "excluding_management_fee" | "unstated" | null,
  "gross_up_pct": number | null,
  "expense_stop": number | null,
  "audit_rights": true | false | null,
  "pro_rata_method": "rentable" | "leasable" | "occupied" | "gross" | null,
  "renewal_options": string | null,
  "excluded_categories": string | null,
  "security_deposit": number | null,
  "property_name": string | null,
  "quotes": {
    "cam_cap": string | null,
    "admin_fee_pct": string | null,
    "admin_fee_basis": string | null,
    "gross_up_pct": string | null,
    "expense_stop": string | null,
    "audit_rights": string | null,
    "pro_rata_method": string | null,
    "renewal_options": string | null,
    "base_rent": string | null,
    "security_deposit": string | null,
    "tenant_name": string | null,
    "lease_type": string | null,
    "sqft": string | null,
    "lease_start_date": string | null,
    "lease_end_date": string | null
  }
}

Rules:
- tenant_name: HIGHEST PRIORITY. The text may be OCR'd from a scanned document — tolerate spacing/character noise.
  Step 1: Look for labels "Tenant:", "Lessee:", "Occupant:" and take the name that follows.
  Step 2: If no label, find the first entity name with a suffix: LLC, Inc, Corp, Ltd, Co., L.P.
  Step 3: If multiple entities exist, EXCLUDE any containing: Properties, Realty, Real Estate, Holdings, Capital, Investments, Partners, Trust.
  Step 4: Return the most prominent remaining company name.
  NEVER return null if any company name exists anywhere in the text.
- lease_start_date: YYYY-MM-DD. Hierarchy: "Commencement Date" → "Lease Start Date" → "Term begins" → "Effective Date" → "Execution Date". Calculate from context if needed. Never null if any date exists.
- lease_end_date: YYYY-MM-DD. Hierarchy: "Expiration Date" → "Lease End Date" → "Term ends". Calculate from start_date + term length if needed. Never null if start date and term length are both known.
- lease_type: One of "NNN", "Gross", "Modified Gross".
  Explicit: "Triple Net" / "Triple-Net" / "NNN" → "NNN". "Modified Gross" → "Modified Gross". "Gross" → "Gross".
  Inferred: If tenant pays "Pro Rata Share" of taxes + insurance + operating expenses → "NNN".
  If landlord pays operating expenses → "Gross".
  If some expenses split → "Modified Gross". Null only if completely unresolvable.
- sqft: Integer. Strip commas, units, and the word "approximately". Null if not found.
- cam_cap: CRITICAL — you MUST search the entire document for any language that limits CAM or operating expense increases. Look for ALL of the following phrases: "CAM cap", "operating expense cap", "expense stop", "base year stop", "not to exceed", "shall not pay more than", "increases limited to", "capped at", "no more than X% increase", "annual increase cap", "controllable expense cap". If a percentage is found (e.g. "5%" or "5 percent"), return 5. If a dollar amount is found, return that number. Only return null if absolutely no cap-related language exists anywhere in the document.
- admin_fee_pct: Look for "management fee", "administrative fee not to exceed X%", "admin fee cap". Return percentage number only (e.g. 15 for "15%"). Null if not found.
- admin_fee_basis: What that percentage is OF. "of operating expenses"/"of CAM costs" -> "operating_expenses". "of controllable expenses" -> "controllable_expenses". Fee excluded from its own base ("exclusive of such fee") -> "excluding_management_fee". A fee percentage with no stated base -> "unstated". Null ONLY when there is no fee cap clause at all. Never guess a base.
- gross_up_pct: Look for "gross up", "grossed up to X% occupancy", "occupancy factor". Return percentage (e.g. 95 for "95% occupancy"). Null if not found.
- expense_stop: Look for "expense stop", "base year stop", "base operating expenses of $X per square foot". Return dollar amount per sqft if found, else null.
- audit_rights: Return true if tenant has explicit right to audit CAM records. Return false if explicitly waived. Return null if not addressed.
- pro_rata_method: Return "rentable", "leasable", "occupied", or "gross" based on how the lease defines the pro-rata denominator. Return null if unresolvable.
- renewal_options: Short description including count, term length, and rate basis (max 120 chars). Null if no renewal options stated.
- excluded_categories: Comma-separated list of expense categories explicitly excluded from CAM (e.g. "capital expenditures, management fees, structural repairs"). Return null if no exclusion schedule is stated.
- suite: The tenant's unit or suite identifier. Look for "Suite", "Unit", "Space", "Ste.", "#" labels. Return the short designator (e.g. "101", "Suite A", "200"). Null if not identified.
- base_rent: Annual base rent in dollars as a plain number. If the lease states a monthly amount, multiply by 12. Look for "Base Rent", "Annual Rent", "Minimum Rent", "Fixed Rent", "Monthly Rent". Null if not found.
- security_deposit: Security deposit in dollars as a plain number. Look for "Security Deposit", "Deposit", "Holdback". Null if not found.
- property_name: The name or address of the building/property the lease covers, as stated in the lease (e.g. "Lakeview Plaza", "123 Main Street"). Look in the premises description, recitals, or property address fields. Null if no property/building name or address is stated.
- quotes: For each field where you return a non-null value, copy ≤120 chars of the exact verbatim clause text from the lease that led to that value. Return null for any field where the value is null.
- Use null only when a field is truly impossible to determine.`;

// ── Lender reserve / escrow extraction ──────────────────────────────────────
// Moved verbatim from script.js CLAUDE_ESCROW_SYSTEM.
const ESCROW_EXTRACTION_SYSTEM = `You are a strict JSON extraction engine for lender reserve and escrow documents (mortgage agreements, loan agreements, escrow agreements, reserve agreements, capital expenditure reserve schedules, insurance settlement documents, lender draw instructions, repair reserve documentation).
Return ONLY valid JSON. No text. No explanation. No markdown. Start with [ and end with ].

A single document often governs MORE THAN ONE reserve account (e.g. a loan agreement with a separate Roof Reserve, HVAC Reserve, and Capital Reserve, each with its own balance and rules). Return a JSON ARRAY with one element per distinct reserve account the document describes. If the document only describes one reserve, return an array with exactly one element. Each array element follows this structure:
{
  "reserve_type": string,
  "reserve_name": string | null,
  "current_balance": number | null,
  "eligible_uses": string | null,
  "requires_invoices": true | false | null,
  "requires_photos": true | false | null,
  "requires_lien_waivers": true | false | null,
  "requires_contractor_bids": true | false | null,
  "requires_engineer_certification": true | false | null,
  "min_draw_amount": number | null,
  "requires_approval": true | false | null,
  "draw_request_deadline": "YYYY-MM-DD" | null,
  "repair_completion_deadline": "YYYY-MM-DD" | null,
  "reserve_expiration_date": "YYYY-MM-DD" | null,
  "notes": string | null,
  "evidence": {
    "reserve_type":    { "quote": string | null, "page": number | null },
    "current_balance": { "quote": string | null, "page": number | null },
    "eligible_uses":    { "quote": string | null, "page": number | null }
  }
}

Rules:
- Treat each named reserve/escrow account as its own array element. Do not merge balances or terms from different reserves into one element.
- reserve_type: Identify which kind of reserve this element governs. Use one of: "Roof Reserve", "HVAC Reserve", "Tenant Improvement Reserve", "Leasing Commission Reserve", "Capital Reserve", "Insurance Recovery Reserve", or the lender's own term if none of those fit.
- reserve_name: If the lender gives this reserve a specific account name (e.g. "Special Reserve Account No. 4"), return it verbatim. Null otherwise.
- current_balance: The reserve balance stated in the document for THIS reserve, as a plain number (no $ or commas). Null if not stated.
- eligible_uses: A short description (max 200 chars) of what THIS reserve's funds may be used for (e.g. "Roof repair and replacement only").
- requires_invoices: true if the lender requires paid/unpaid invoices to support a draw request against this reserve. Default to true unless the document explicitly says otherwise.
- requires_photos: true if before/after photos of completed work are required for a draw against this reserve.
- requires_lien_waivers: true if lien waivers (conditional or unconditional) are required for this reserve.
- requires_contractor_bids: true if contractor bids/estimates must be submitted before work funded by this reserve is approved.
- requires_engineer_certification: true if a licensed engineer or architect must certify work funded by this reserve.
- min_draw_amount: The minimum dollar amount per draw request against this reserve, if stated. Null otherwise.
- requires_approval: true if the lender (or a third party such as a construction inspector) must approve a draw against this reserve before funding. Default true unless explicitly waived.
- draw_request_deadline: The deadline by which draw requests against this reserve must be submitted, if a fixed or recurring deadline is stated.
- repair_completion_deadline: The deadline by which the underlying repair/improvement work funded by this reserve must be completed.
- reserve_expiration_date: The date after which this reserve account terminates or unused funds are released/forfeited.
- notes: Any other reserve-specific requirement or condition worth flagging for this reserve (max 300 chars). Null if nothing additional applies.
- evidence: For reserve_type, current_balance, and eligible_uses, copy ≤160 chars of the exact verbatim clause text that produced that value, AND the page number from the nearest preceding "--- Page N ---" marker in the document text. Both null if the value itself is null or the page cannot be determined.
- Never paraphrase a quote — it must be copied character-for-character from the source text.
- Use null only when a field is truly impossible to determine. Do not guess a page number; null is acceptable.`;

// ── Invoice / bill field extraction ─────────────────────────────────────────
// Moved from script.js INVOICE_PROMPT. It travelled in the USER turn rather
// than as a system prompt, which made it indistinguishable from the invoice
// image beside it — instructions and data at the same level. It is a system
// prompt now, for the same reason AI-3 separated the lease from the question.
const INVOICE_EXTRACTION_SYSTEM = `You are extracting data from a commercial real estate invoice or bill.
This document may be a scanned image — tolerate OCR noise, spacing issues, and number formatting quirks.
Return ONLY valid JSON. No explanation. No markdown.

{
  "vendorName": string,
  "amount": number,
  "invoiceDate": "YYYY-MM-DD" or null,
  "category": string,
  "confidence": { "vendorName": 0-100, "amount": 0-100, "invoiceDate": 0-100, "category": 0-100 }
}

RULES:
- vendorName: The company that issued the invoice (top of page, "From:", "Bill From:", or largest company name). Not the property owner.
- amount: Total due / Amount due / Invoice total. Numbers only — strip $, commas. If you see periods used as thousand separators (e.g. "1.200,00") convert correctly. Never null if any dollar amount exists.
- invoiceDate: Invoice date / Bill date / Date issued. YYYY-MM-DD format. Not the due date.
- category: One of: insurance, landscaping, snow, repairs, utilities, janitorial, security, management, other.
  - insurance → any insurance company, premium, policy, or coverage
  - utilities → electric, gas, water, sewer, telecom
  - landscaping → lawn, grounds, irrigation, tree, mulch
  - snow → snow removal, plowing, salting, ice
  - repairs → maintenance, HVAC, plumbing, roof, painting, carpentry
  - janitorial → cleaning, custodial, sanitation
  - security → alarm, guard, monitoring, access control
  - management → property management, admin fee
- confidence: 0 = not found, 100 = explicitly labeled`;

// ── Invoice category classification ─────────────────────────────────────────
// Moved from script.js CATEGORY_PROMPT, same reasoning.
const CATEGORY_CLASSIFICATION_SYSTEM = `Classify this invoice into ONE category:
[insurance, landscaping, snow, repairs, janitorial, utilities, other]

Prioritize vendor name when obvious (e.g. insurance companies → insurance).

Return JSON:
{ "category": "...", "confidence": 0.0-1.0 }`;

// Acquisition Review P1-3 — what a document IS, and who it is between.
//
// It classifies and NOTHING ELSE. It does not read terms, does not decide what
// a document changes, and does not put a document in a family: those are
// decisions made from the classification, by code that can be tested, and by a
// person who confirms them. Adding term extraction here would make this a
// second lease contract beside lease_extraction, which the roadmap (D-6)
// explicitly refuses.
//
// "unknown" IS AN ANSWER. A model that must choose from a list will choose
// from a list, and a confidently wrong document type propagates into families,
// governing terms and a report. The instruction to return unknown rather than
// guess is the most important line in this prompt.
const DOCUMENT_CLASSIFICATION_SYSTEM = `You classify a commercial real estate document for an acquisition review.
This may be a scanned image — tolerate OCR noise and spacing issues.
Return ONLY valid JSON. No explanation. No markdown.

{
  "docType": string,
  "docDate": "YYYY-MM-DD" or null,
  "tenantName": string or null,
  "suite": string or null,
  "confidence": 0.0-1.0,
  "evidence": string or null
}

docType MUST be exactly one of:
  original_lease      a lease that creates a tenancy
  amendment           changes an existing lease
  renewal             extends a term under an existing renewal right
  extension           extends a term without exercising a renewal option
  assignment          transfers a lease to a new tenant
  guaranty            a third party guarantees a tenant's obligations
  side_letter         a side agreement modifying or clarifying a lease
  snda                subordination, non-disturbance and attornment
  estoppel            a tenant's certificate of the lease's current state
  psa                 purchase and sale agreement for the property
  rent_roll           a schedule of tenants, rents and terms
  financial_statement operating statement, income statement, GL, budget
  invoice             a bill from a vendor
  other               a real document that is none of the above
  unknown             you cannot tell

RULES:
- If you are not confident, return "unknown". Do NOT pick the closest match.
  A wrong document type is worse than an absent one — it flows into lease
  families and governing terms and is expensive to undo.
- docDate: the document's OWN effective/commencement/execution date, not a date
  it refers to and not today. Null if you cannot find one.
- tenantName: the TENANT, not the landlord, owner, guarantor or agent. For an
  assignment, name the ASSIGNEE (the incoming tenant). Null if unclear.
- suite: the suite or unit identifier if the document states one.
- confidence: your confidence in docType only, 0.0 to 1.0.
- evidence: the short phrase from the document that decided docType — quoted
  verbatim, at most 200 characters. Null if nothing specific decided it.
- Never infer a document type from the file name. Read the document.`;

// Acquisition Review P1-4 (P4-1) — what a document SAYS, term by term.
//
// This is the second half of what document_classification deliberately refused
// to do. Classification says what a document IS; this says what it ESTABLISHES,
// for a fixed vocabulary of 27 terms, with the clause behind each one. It is
// still not lease_extraction: it does not resolve a tenant record, does not
// pick a tenant name over another, and does not decide which document governs
// — LeaseIntelligence.reasonMultiDocumentLease does that, from this evidence.
//
// The 27 names are acquisition-terms.js's and are reproduced here verbatim —
// a test holds the two lists equal. Group A is LeaseIntelligence's canonical
// thirteen; B is what lease_extraction already returns; C is the nine the
// approved plan named. None may be dropped or renamed here.
//
// MISSING IS NOT NONE. A term the document does not address is
// { value: null, quote: null }. A document that says "Tenant shall have no
// option to renew" establishes the term — the value is what it says, and the
// quote is the clause. The instruction to never turn the first into the second
// is the most important line in this prompt.
const ACQUISITION_ABSTRACTION_SYSTEM = `You read ONE commercial lease document (a lease, an amendment, a renewal, an extension, an assignment, a guaranty, a side letter, an SNDA or an estoppel) for an acquisition review and report what THIS DOCUMENT SAYS about each of the terms below.
The text may be OCR'd from a scan — tolerate spacing and character noise.
Return ONLY valid JSON. No explanation. No markdown. Start with { and end with }.

{
  "fields": {
    "<field>": { "value": <typed value> | null, "quote": string | null, "page": number | null, "confidence": 0.0-1.0 | null }
  }
}

Report EVERY one of these 27 fields, each exactly once, under exactly these keys:

  cap                           number   — annual CAM / operating-expense increase cap; a percentage as a plain number (5 for "5%"), or a dollar amount
  cap_base_amount               number   — the dollar base the cap is measured from, when stated
  admin_fee_pct                 number   — administrative / management fee percentage (15 for "15%")
  gross_up_pct                  number   — gross-up occupancy percentage (95 for "95%")
  expense_stop                  number   — expense stop or base-year stop, dollars per square foot
  audit_rights                  boolean  — true if the tenant has an explicit right to audit; false if explicitly waived
  pro_rata_method               "rentable" | "leasable" | "occupied" | "gross" — the pro-rata denominator
  renewal_options               string   — count, term and rate basis of renewal options, or the clause that denies them
  tenant_name                   string   — the tenant named in THIS document (for an assignment, the assignee)
  leased_sqft                   number   — the premises' square footage as an integer
  start_date                    "YYYY-MM-DD" — commencement date THIS document states or changes
  end_date                      "YYYY-MM-DD" — expiration date THIS document states or changes
  lease_type                    "NNN" | "Gross" | "Modified Gross"
  base_rent                     number   — annual base rent in dollars (monthly × 12)
  security_deposit              number   — security deposit in dollars
  suite                         string   — suite / unit designator
  excluded_categories           string   — expense categories excluded from CAM, comma-separated
  admin_fee_basis               "operating_expenses" | "controllable_expenses" | "excluding_management_fee" | "unstated"
  tenant_improvement_allowance  number   — TI allowance in dollars (total, or per square foot if that is how it is stated — say which in the quote)
  landlord_work                 string   — landlord's work / delivery obligations, briefly
  guarantor_name                string   — the guarantor of the tenant's obligations
  guaranty_limit                number   — the dollar cap on the guaranty, when stated
  termination_rights            string   — any early termination right, its trigger, notice and fee
  expansion_rights              string   — expansion, right of first refusal or right of first offer
  assignment_consent            string   — the standard for landlord consent to assignment or sublease
  exclusive_use                 string   — any exclusive-use protection granted to the tenant
  co_tenancy                    string   — any co-tenancy condition and its remedy

RULES:
- value: what THIS document establishes for the term, in the type shown. Use null when this document does not address the term. Do not carry a value over from what a lease "usually" says, from the file name, or from any other document.
- MISSING IS NOT NONE. If the document says nothing about a term, value is null and quote is null. If the document EXPLICITLY denies or waives a term — "Tenant shall have no option to renew", "there shall be no cap on Operating Expenses", "Tenant waives any right to audit" — that is a VALUE (the denying language for a string field; 0 for a number field; false for a boolean), with the clause as its quote. Never report an unaddressed term as 0, false, "none" or "".
- quote: the exact verbatim span of the document that establishes the value — copied character for character, at most 600 characters, the shortest span that establishes it. Never paraphrase. A value with no quote will not be trusted, so if you cannot quote it, report the value as null.
- page: the page number from the nearest preceding "--- Page N ---" marker in the text, ONLY when such a marker is present and you are certain. Otherwise null. Never guess a page.
- confidence: your confidence that the value is what this document establishes, 0.0 to 1.0. Null when value is null.
- An amendment, side letter or estoppel usually addresses only a few terms. Report null for the rest. Do not invent what an amendment does not change.
- Never infer anything from the file name. Read the document.`;

/**
 * SEC-2 + AI-3 — extraction reads customer documents, so the boundary rule
 * applies here as much as it does to Ask-the-Lease. A lease is a document one
 * party to a negotiation hands the other; a line inside it aimed at the
 * landlord's extractor must be transcribed as text, never obeyed.
 */
function _withBoundary(system) {
  return system + '\n\n' + UNTRUSTED_DOCUMENT_RULE;
}

/**
 * Every extraction this endpoint will perform. Adding one is a deliberate act.
 *
 * maxTokens is a per-task ceiling matching what each call site legitimately
 * needs — the lease schema fits in 1500, the escrow schema returns an array and
 * needs 2400. No task may exceed its own ceiling.
 */
const CLAUDE_TASKS = {
  lease_extraction:  { system: _withBoundary(LEASE_EXTRACTION_SYSTEM),  maxTokens: 1500 },
  escrow_extraction: { system: _withBoundary(ESCROW_EXTRACTION_SYSTEM), maxTokens: 2400 },
  invoice_extraction:       { system: _withBoundary(INVOICE_EXTRACTION_SYSTEM),       maxTokens: 1024 },
  category_classification:  { system: _withBoundary(CATEGORY_CLASSIFICATION_SYSTEM),  maxTokens: 64   },
  // Acquisition Review P1-3. Six small fields and a short quote; 400 is room
  // for that and not for an abstraction.
  document_classification:  { system: _withBoundary(DOCUMENT_CLASSIFICATION_SYSTEM),  maxTokens: 400  },
  // Acquisition Review P1-4. Twenty-seven fields, each with a verbatim quote
  // of up to 600 characters: ~200 tokens a field when every one is addressed,
  // which an original lease can do. A truncated reply is unparseable and the
  // whole reading is lost, so the ceiling sits above the worst case.
  acquisition_abstraction:  { system: _withBoundary(ACQUISITION_ABSTRACTION_SYSTEM),  maxTokens: 6000 },
};

/**
 * Resolves a requested task, or explains why it cannot be resolved.
 * Returns { ok: true, name, task } or { ok: false, status, error }.
 */
function resolveClaudeTask(body) {
  const b = body || {};
  // Refused, not ignored: a caller whose instructions vanished silently would
  // go on believing they were in force.
  if (b.system != null) {
    return { ok: false, status: 400,
      error: 'This endpoint does not accept a system prompt. Extraction instructions are server-controlled — send { task } instead.' };
  }
  if (typeof b.task !== 'string' || !b.task) {
    return { ok: false, status: 400,
      error: `Missing required field: task. Expected one of: ${Object.keys(CLAUDE_TASKS).join(', ')}` };
  }
  const task = Object.prototype.hasOwnProperty.call(CLAUDE_TASKS, b.task) ? CLAUDE_TASKS[b.task] : null;
  if (!task) {
    return { ok: false, status: 400,
      error: `Unknown task: ${b.task}. Expected one of: ${Object.keys(CLAUDE_TASKS).join(', ')}` };
  }
  return { ok: true, name: b.task, task };
}

/** Per-task token ceiling. A caller may ask for less, never for more. */
function resolveClaudeMaxTokens(requested, task) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return task.maxTokens;
  return Math.min(Math.floor(n), task.maxTokens);
}

module.exports = { CLAUDE_TASKS, resolveClaudeTask, resolveClaudeMaxTokens };
