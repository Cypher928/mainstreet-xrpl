'use strict';
/**
 * _validate-lease-contract.js — the CAM-vs-lease audit contract.
 *
 * The system prompt and the user-turn builder live here for the same reason the
 * Ask-the-Lease pair does (see _ask-lease-contract.js): api/validate-lease.js
 * mixes `require` with `export default`, so Node can load it under neither
 * module system and a test can only ever assert about its source text. Anything
 * a test must actually EXERCISE has to live in a module it can load.
 *
 * A finding from this endpoint can put a landlord in front of a tenant claiming
 * a charge violates the lease. The rules that govern it are worth testing for
 * real rather than grepping for.
 */

const { UNTRUSTED_DOCUMENT_RULE, wrapUntrustedDocument } = require('./_untrusted-text');

// AI-3 — this endpoint had NO system prompt. Every rule it relies on ("never
// return warning or critical for lease silence", "a missed finding is
// acceptable, an unsupported critical finding is not") travelled in the user
// turn, positioned AFTER the customer's lease text — so the last thing the
// model read before answering was the untrusted document.
//
// The rules are now a system prompt, the document is delimited and cannot close
// its own container, and the reconciliation data sits outside it. A finding
// here can put a landlord in front of a tenant claiming a charge violates the
// lease; the instructions that govern it belong where a document cannot reach.
const VALIDATION_SYSTEM = `You are a commercial real estate lease compliance auditor.
Review the supplied lease against the CAM reconciliation data and perform exactly the three checks named in the user turn.

${UNTRUSTED_DOCUMENT_RULE}

STRICT RULES:
- Only report severity "critical" when you can cite exact verbatim lease language AND a specific section reference. Both quote and section must be non-null.
- If the lease is silent or ambiguous on an item, return severity "info" and confidence "high". Never return "warning" or "critical" for lease silence.
- Confidence must reflect how directly the lease language supports the finding: "high" = explicit exact language, "medium" = related but ambiguous language, "low" = inferred.
- Prefer fewer high-confidence findings. A missed finding is acceptable; an unsupported critical finding is not.

Return ONLY valid JSON — no markdown, no text outside the object:
{
  "findings": [
    {
      "check": "CAM_EXCLUSIONS",
      "severity": "info" | "warning" | "critical",
      "confidence": "high" | "medium" | "low",
      "finding": "Human-readable summary (1-2 sentences)",
      "quote": "Verbatim excerpt from the lease or null",
      "section": "Section X.Y or null",
      "page": 12,
      "explanation": "Why this conflicts with the reconciliation, or null if compliant"
    }
  ]
}`;

function buildClausePrompt(leaseText, lineItems, totalExpenses, year) {
  const itemLines = (lineItems || [])
    .map(li => `  - ${li.category}: $${Number(li.amount || 0).toLocaleString()}`)
    .join('\n') || '  (none provided)';

  return `RECONCILIATION DATA (${year || 'current year'}):
  Total CAM Expenses: $${Number(totalExpenses || 0).toLocaleString()}
  Line Items:
${itemLines}

${wrapUntrustedDocument(leaseText)}

CHECKS TO PERFORM:
1. CAM_EXCLUSIONS — Do any reconciliation line items appear in the lease's explicit CAM exclusion list?
2. STRUCT_EXCLUSIONS — Does the reconciliation include capital expenditures or structural repairs that the lease explicitly excludes from CAM?
3. TAX_ALLOCATION — Is property tax handling in the reconciliation consistent with the lease's stated allocation method?`;
}

module.exports = { VALIDATION_SYSTEM, buildClausePrompt };
