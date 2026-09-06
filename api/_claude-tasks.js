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
