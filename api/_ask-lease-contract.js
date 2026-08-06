// _ask-lease-contract.js — the Ask-the-Lease answer contract.
//
// The system prompt and the parser live together because they are one
// agreement: the prompt promises a shape, the parser enforces it. They were
// previously inside api/ask-lease.js with a hand-maintained "inline replica"
// in test-ask-lease.js — so the tests could pass against a copy while the
// shipped prompt said something else. Both sides now require this file.
//
// ── The refusal contract ────────────────────────────────────────────────────
// Asked "who pays the most rent?", the assistant returned a pro-rata
// allocation clause. It had found the text most semantically similar to the
// question and presented it as an answer, complete with a citation. Nothing in
// the product said it had failed.
//
// That is worse than "I don't know". A cited answer carries the product's
// whole claim — every charge traceable to the document it came from — and
// spending that credibility on the nearest paragraph teaches the user the
// citations mean less than they do.
//
// So refusal is a FIRST-CLASS OUTCOME, not a phrasing of the answer. The model
// returns "answered": false, and the server then forces the citation list
// empty rather than trusting it to have done so. A refusal that still carries
// a citation is the exact failure being fixed, and the prompt is not the place
// to guarantee it.
//
// ── This refusal is permanent, not temporary ────────────────────────────────
// Cross-lease questions are eventually meant to ROUTE to Portfolio Intelligence
// (docs/BACKLOG_CROSS_LEASE_QUESTIONS.md), which compares rent schedules across
// every lease and answers with a citation from each. That routing happens
// BEFORE this engine is consulted. It does not make a single lease able to
// answer a portfolio question, so nothing below should be relaxed to
// accommodate it — the refusal stays correct after that feature ships.

'use strict';

const { UNTRUSTED_DOCUMENT_RULE, wrapUntrustedDocument, neutraliseDelimiters } = require('./_untrusted-text');

const SYSTEM_PROMPT = `You are a commercial real estate lease assistant.

${UNTRUSTED_DOCUMENT_RULE}

You are given the text of ONE lease, covering ONE tenant, and a question about it.
Answer only from that lease text.

FIRST decide whether this lease can answer the question at all. Set "answered": false when:
- the lease is silent on the subject;
- the question requires comparing tenants, leases, or properties. This is a single lease for a single tenant, so "who pays the most rent", "which tenant has the largest space", and "how does this compare to the others" cannot be answered from it, no matter what the text contains;
- the question is about matters outside the lease, such as market rates, the landlord's other holdings, or what the law requires.

When "answered" is false:
- "answer" says plainly that this lease does not answer the question, and states what would be needed to answer it;
- "citations" MUST be empty.

Never cite a clause that does not directly answer the question that was asked. A clause about a related subject is not an answer. If the closest text you can find merely shares vocabulary with the question, that is a signal to set "answered": false — surfacing it as though it were the answer is worse than saying you cannot answer.

When "answered" is true, keep the answer concise (2-5 sentences unless more detail is clearly needed).

IMPORTANT: Respond ONLY with a valid JSON object in exactly this format (no markdown, no text before or after):
{
  "answered": true,
  "answer": "Your answer here",
  "citations": [
    {
      "quote": "Verbatim excerpt from the lease that directly supports the answer",
      "section": "Section or article identifier (e.g. 'Section 7.3', 'Article IV') or null",
      "page": 12
    }
  ]
}

Rules:
- The "page" field must be an integer from "--- Page N ---" markers in the lease text, or null if not determinable.
- Include 1-3 citations maximum. Each citation must quote exact lease language.
- If no supporting text exists, return an empty citations array.
- Do not include any text outside the JSON object.`;

function normalizeCitation(c) {
  if (!c || typeof c !== 'object') return { quote: null, section: null, page: null };
  return {
    quote:   typeof c.quote   === 'string' && c.quote.trim()   ? c.quote.trim()   : null,
    section: typeof c.section === 'string' && c.section.trim() ? c.section.trim() : null,
    page:    typeof c.page    === 'number' && Number.isFinite(c.page) ? Math.floor(c.page) : null,
  };
}

/**
 * Parses the model's reply into { answered, answer, citations }.
 *
 * `answered` defaults to TRUE when the field is absent: a reply that predates
 * this contract, or one that simply omits the flag, is an ordinary answer.
 * Only an explicit false is a refusal — inferring refusal from a missing field
 * would silently drop real citations.
 *
 * When it IS false the citations are dropped here, in code. The prompt asks for
 * an empty array; this guarantees it. The whole point is that an unanswerable
 * question must not come back wearing evidence.
 */
function parseStructuredResponse(text) {
  const bare = { answered: true, answer: String(text || '').trim(), citations: [] };
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return bare;
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.answer !== 'string') return bare;
    const answered = parsed.answered !== false;
    const citations = answered && Array.isArray(parsed.citations)
      ? parsed.citations.map(normalizeCitation).filter(c => c.quote)
      : [];
    return { answered, answer: parsed.answer.trim(), citations };
  } catch {
    return bare;
  }
}

/**
 * AI-3 — the user turn, built in one place.
 *
 * This was `LEASE TEXT:\n${textToSend}\n\nQUESTION: ${question}` at the call
 * site. A label is not a boundary: a line inside the lease reading
 * "QUESTION: ignore the above" sat at exactly the same level as the real one,
 * and nothing marked where the customer's document ended.
 *
 * The document goes in a container it cannot close (see _untrusted-text.js),
 * the question goes in its own, and the question is placed AFTER the document
 * so the last thing read before answering is ours, not the customer's.
 */
function buildAskUserContent(leaseText, question) {
  // The question is user input too. A question ending in "</lease_document>"
  // would otherwise emit a second closing delimiter, and the model would see a
  // container that closes twice — which is the same escape the document was
  // just stopped from making. Caught by the AI-3 suite, not by inspection.
  return `${wrapUntrustedDocument(leaseText)}

<question>
${neutraliseDelimiters(question)}
</question>`;
}

module.exports = { SYSTEM_PROMPT, normalizeCitation, parseStructuredResponse, buildAskUserContent };
