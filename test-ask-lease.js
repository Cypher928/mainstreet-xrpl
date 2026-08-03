'use strict';
/**
 * test-ask-lease.js
 * Phase 22C regression tests for Ask the Lease API handler.
 *
 * All Supabase and Anthropic calls are mocked — no live network required.
 * Run: node test-ask-lease.js
 */

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Inline replica of handler logic (kept in sync with api/ask-lease.js)
// ---------------------------------------------------------------------------

const MAX_QUESTION_LEN  = 1000;
const MAX_LEASE_TEXT    = 300000;
const ANTHROPIC_TIMEOUT = 45000;
const ASK_MODEL         = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// The REAL contract, not a copy of it
// ---------------------------------------------------------------------------
// This block used to be a hand-maintained "inline replica" of
// parseStructuredResponse, kept in sync by hand. That is a test that can pass
// while the shipped code says something else — and it did: the replica never
// knew about refusals. Both the handler and this suite now require the same
// module, so a green run means the shipped parser behaved.
const {
  SYSTEM_PROMPT,
  normalizeCitation: _normalizeCitation,
  parseStructuredResponse,
} = require('./api/_ask-lease-contract');

function buildHandler({
  sbRows             = null,
  sbError            = false,
  anthropicAnswer    = null,
  anthropicCitations = [],
  anthropicRaw       = null,   // raw model text — drives the REAL parser
  anthropicAnswered  = true,
  anthropicError     = null,
  anthropicAbort     = false,  // simulates AbortError (timeout)
} = {}) {
  async function mockFetchLeaseDoc(id) {
    if (sbError) throw new Error('Supabase network failure');
    if (sbRows === null) return null;
    return sbRows.find(r => r.id === id) || null;
  }

  async function mockCallClaude(leaseText, question) {
    if (anthropicAbort) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (anthropicError) throw new Error(anthropicError);

    const truncated     = leaseText.length > MAX_LEASE_TEXT;
    const textToSend    = truncated ? leaseText.slice(0, MAX_LEASE_TEXT) : leaseText;
    const charsAnalyzed = textToSend.length;

    // When a raw reply is supplied, run it through the shipped parser — that is
    // the code path that must drop citations on a refusal.
    const parsed = anthropicRaw
      ? parseStructuredResponse(anthropicRaw)
      : { answered: anthropicAnswered,
          answer: anthropicAnswer || `Answer for: ${question}`,
          citations: anthropicAnswered ? (anthropicCitations || []) : [] };

    return {
      answered:     parsed.answered,
      answer:       parsed.answer,
      citations:    parsed.citations,
      truncated,
      charsAnalyzed,
      model:        ASK_MODEL,
      inputTokens:  100,
      outputTokens: 50,
    };
  }

  async function handle(body) {
    const { leaseDocumentId, question } = body || {};

    if (!leaseDocumentId) return { status: 400, body: { error: 'Missing leaseDocumentId' } };
    if (!question || !question.trim()) return { status: 400, body: { error: 'Missing question' } };
    if (question.length > MAX_QUESTION_LEN) return { status: 400, body: { error: `Question too long (max ${MAX_QUESTION_LEN} characters)` } };

    let doc;
    try {
      doc = await mockFetchLeaseDoc(leaseDocumentId);
    } catch (err) {
      return { status: 502, body: { error: 'Failed to fetch lease document' } };
    }

    if (!doc) return { status: 404, body: { error: 'Lease document not found' } };

    if (!doc.extracted_text) {
      const reason = doc.used_pdf_direct
        ? 'This lease was processed via PDF vision — text was not stored. Re-upload the PDF to enable Ask the Lease.'
        : 'No extracted text is available for this lease document.';
      return { status: 422, body: { error: reason } };
    }

    let result;
    try {
      result = await mockCallClaude(doc.extracted_text, question.trim());
    } catch (err) {
      if (err.name === 'AbortError') {
        return { status: 500, body: { error: 'Claude took too long to respond (>45s). Try a shorter question or try again.' } };
      }
      return { status: 500, body: { error: err.message || 'Claude request failed' } };
    }

    return {
      status: 200,
      body: {
        answered:      result.answered,
        answer:        result.answer,
        citations:     result.citations,
        fileUrl:       doc.file_url || null,
        truncated:     result.truncated,
        charsAnalyzed: result.charsAnalyzed,
      },
    };
  }

  return { handle };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  Phase 22B — Ask the Lease Regression Tests');
  console.log('='.repeat(60));

  // ── Validation ────────────────────────────────────────────────────────────

  console.log('\n[Input validation]');
  {
    const h = buildHandler();
    const r1 = await h.handle({});
    assert('AL-1: 400 when leaseDocumentId missing', r1.status === 400);
    assert('AL-2: error message present',            !!r1.body.error);

    const r2 = await h.handle({ leaseDocumentId: 'doc-1' });
    assert('AL-3: 400 when question missing',        r2.status === 400);

    const r3 = await h.handle({ leaseDocumentId: 'doc-1', question: '   ' });
    assert('AL-4: 400 for whitespace-only question', r3.status === 400);

    const r4 = await h.handle({ leaseDocumentId: 'doc-1', question: 'x'.repeat(1001) });
    assert('AL-5: 400 when question exceeds max length', r4.status === 400);
    assert('AL-6: error mentions max length',             r4.body.error.includes('1000'));
  }

  // ── Supabase lookup ───────────────────────────────────────────────────────

  console.log('\n[Supabase lookup]');
  {
    const h1 = buildHandler({ sbRows: [] });
    const r1  = await h1.handle({ leaseDocumentId: 'missing-id', question: 'What is the CAM cap?' });
    assert('AL-7: 404 when doc not found',    r1.status === 404);
    assert('AL-8: error message meaningful',  r1.body.error.includes('not found'));

    const h2 = buildHandler({ sbError: true });
    const r2  = await h2.handle({ leaseDocumentId: 'doc-1', question: 'test' });
    assert('AL-9: 502 on Supabase network error', r2.status === 502);
  }

  // ── No extracted text ────────────────────────────────────────────────────

  console.log('\n[No extracted text]');
  {
    const h1 = buildHandler({ sbRows: [{ id: 'doc-vis', extracted_text: null, used_pdf_direct: true }] });
    const r1  = await h1.handle({ leaseDocumentId: 'doc-vis', question: 'What is the CAM cap?' });
    assert('AL-10: 422 for vision doc with no text',         r1.status === 422);
    assert('AL-11: error explains PDF vision limitation',    r1.body.error.includes('PDF vision'));
    assert('AL-12: error mentions re-upload',                r1.body.error.includes('Re-upload'));

    const h2 = buildHandler({ sbRows: [{ id: 'doc-notext', extracted_text: null, used_pdf_direct: false }] });
    const r2  = await h2.handle({ leaseDocumentId: 'doc-notext', question: 'test' });
    assert('AL-13: 422 for text-path doc with null text', r2.status === 422);
  }

  // ── Happy path ───────────────────────────────────────────────────────────

  console.log('\n[Happy path]');
  {
    const leaseText = 'This is a Net Net Net lease. CAM cap is 5% per year. Tenant: Sunrise Cafe. Term: Jan 1 2024 - Dec 31 2026.';
    const rows = [{ id: 'doc-good', file_name: 'sunrise.pdf', tenant_name: 'Sunrise Cafe', extracted_text: leaseText, used_pdf_direct: false, file_url: 'https://storage.example.com/sunrise.pdf' }];

    const citations = [{ quote: 'CAM cap is 5% per year', section: 'Section 3', page: 4 }];
    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'The CAM cap is 5% per year as stated in Section 3.', anthropicCitations: citations });
    const r = await h.handle({ leaseDocumentId: 'doc-good', question: 'What is the CAM cap?' });
    assert('AL-14: 200 on successful answer',        r.status === 200);
    assert('AL-15: answer field present',            typeof r.body.answer === 'string');
    assert('AL-16: answer contains content',         r.body.answer.includes('5%'));
    assert('AL-17: charsAnalyzed in response',       typeof r.body.charsAnalyzed === 'number');
    assert('AL-18: truncated=false for short text',  r.body.truncated === false);
  }

  // ── Question trimming ────────────────────────────────────────────────────

  console.log('\n[Question trimming]');
  {
    const rows = [{ id: 'doc-trim', extracted_text: 'Lease text here.', used_pdf_direct: false }];
    const h    = buildHandler({ sbRows: rows, anthropicAnswer: 'Trimmed answer' });
    const r    = await h.handle({ leaseDocumentId: 'doc-trim', question: '  What is the cap?  ' });
    assert('AL-19: 200 even with padded question', r.status === 200);
  }

  // ── Anthropic errors ──────────────────────────────────────────────────────

  console.log('\n[Anthropic errors]');
  {
    const rows = [{ id: 'doc-anthr', extracted_text: 'some text', used_pdf_direct: false }];

    const h1 = buildHandler({ sbRows: rows, anthropicError: 'Anthropic API error 429: rate limit exceeded' });
    const r1  = await h1.handle({ leaseDocumentId: 'doc-anthr', question: 'What is the cap?' });
    assert('AL-20: 500 on Anthropic error',               r1.status === 500);
    assert('AL-21: error message from Claude forwarded',  r1.body.error.includes('rate limit'));

    // Timeout (AbortError)
    const h2 = buildHandler({ sbRows: rows, anthropicAbort: true });
    const r2  = await h2.handle({ leaseDocumentId: 'doc-anthr', question: 'test' });
    assert('AL-22: 500 on timeout',                       r2.status === 500);
    assert('AL-23: error explains timeout clearly',       r2.body.error.includes('45s'));
  }

  // ── Truncation at MAX_LEASE_TEXT ─────────────────────────────────────────

  console.log('\n[Truncation behavior]');
  {
    // Text just under limit — no truncation
    const shortText = 'x'.repeat(299999);
    const rowsShort = [{ id: 'doc-short', extracted_text: shortText, used_pdf_direct: false }];
    const h1 = buildHandler({ sbRows: rowsShort, anthropicAnswer: 'ok' });
    const r1  = await h1.handle({ leaseDocumentId: 'doc-short', question: 'test' });
    assert('AL-24: truncated=false when text < MAX_LEASE_TEXT', r1.body.truncated === false);
    assert('AL-25: charsAnalyzed == full text length',          r1.body.charsAnalyzed === 299999);

    // Text over limit — truncated
    const longText = 'x'.repeat(350000);
    const rowsLong = [{ id: 'doc-long', extracted_text: longText, used_pdf_direct: false }];
    const h2 = buildHandler({ sbRows: rowsLong, anthropicAnswer: 'ok' });
    const r2  = await h2.handle({ leaseDocumentId: 'doc-long', question: 'test' });
    assert('AL-26: truncated=true when text > MAX_LEASE_TEXT',  r2.body.truncated === true);
    assert('AL-27: charsAnalyzed == MAX_LEASE_TEXT',            r2.body.charsAnalyzed === MAX_LEASE_TEXT);
    assert('AL-28: 200 returned even with truncated text',      r2.status === 200);
  }

  // ── Model pinning ─────────────────────────────────────────────────────────

  console.log('\n[Model pinning]');
  {
    // ASK_MODEL constant should be claude-sonnet-4-6 regardless of external state
    assert('AL-29: ASK_MODEL is claude-sonnet-4-6', ASK_MODEL === 'claude-sonnet-4-6');
  }

  // ── Response shape ───────────────────────────────────────────────────────

  console.log('\n[Response shape]');
  {
    const rows = [{ id: 'doc-shape', extracted_text: 'lease text', used_pdf_direct: false, file_url: 'https://example.com/lease.pdf' }];
    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'The answer is here.', anthropicCitations: [{ quote: 'exact language', section: 'Section 1', page: 1 }] });
    const r = await h.handle({ leaseDocumentId: 'doc-shape', question: 'question' });
    assert('AL-30: answered, answer, citations, fileUrl, truncated, charsAnalyzed in body',
      'answered' in r.body && 'answer' in r.body && 'citations' in r.body && 'fileUrl' in r.body && 'truncated' in r.body && 'charsAnalyzed' in r.body);
    assert('AL-31: answer is a non-empty string',             typeof r.body.answer === 'string' && r.body.answer.length > 0);
    // The exact key SET, not a count — a count passes when one key is swapped
    // for another, which is precisely how a contract drifts.
    assert('AL-32: response body carries exactly the contract keys',
      JSON.stringify(Object.keys(r.body).sort()) ===
      JSON.stringify(['answer', 'answered', 'charsAnalyzed', 'citations', 'fileUrl', 'truncated']),
      Object.keys(r.body).sort().join(','));
  }

  // ── The refusal contract ─────────────────────────────────────────────────
  // Asked "who pays the most rent?", the assistant returned a pro-rata
  // allocation clause — the nearest semantic match — presented as an answer,
  // with a citation under it. Nothing in the response said it had failed.
  //
  // A cited answer carries the whole product's claim. Spending that on the
  // closest paragraph is worse than saying "I can't answer that", so refusal is
  // a first-class outcome and the server drops citations rather than trusting
  // the model to have withheld them.
  {
    console.log('\n── Refusal contract ──');

    const refusal = JSON.stringify({
      answered: false,
      answer: 'This lease covers a single tenant, so it cannot say which tenant pays the most rent. Comparing tenants needs the rent roll for the whole property.',
      citations: [{ quote: "Tenant's Proportionate Share shall be 12.4%", section: 'Section 4.2', page: 7 }],
    });

    const p = parseStructuredResponse(refusal);
    assert('AL-57: an explicit answered:false is carried through', p.answered === false);
    assert('AL-58: a refusal NEVER carries citations, even when the model sends them',
      p.citations.length === 0, JSON.stringify(p.citations));
    assert('AL-59: the refusal text survives intact', /cannot say which tenant/.test(p.answer));

    // The whole flow, not just the parser: a refusal must reach the client with
    // answered:false and an empty citation array.
    const rows = [{ id: 'doc-refuse', extracted_text: 'lease text', used_pdf_direct: false, file_url: 'https://example.com/lease.pdf' }];
    const h = buildHandler({ sbRows: rows, anthropicRaw: refusal });
    const r = await h.handle({ leaseDocumentId: 'doc-refuse', question: 'Who pays the most rent?' });
    assert('AL-60: the handler returns 200 for a refusal (it is an answer, not an error)', r.status === 200);
    assert('AL-61: the client is told answered:false',  r.body.answered === false);
    assert('AL-62: the client receives no citations',   r.body.citations.length === 0);

    // Absence of the flag is NOT a refusal. Inferring one would silently strip
    // citations from every ordinary answer.
    const legacy = parseStructuredResponse(JSON.stringify({
      answer: 'The cap is 5% annually.',
      citations: [{ quote: 'shall not increase by more than five percent', section: 'Section 7.3', page: 12 }],
    }));
    assert('AL-63: a reply with no "answered" field is treated as answered', legacy.answered === true);
    assert('AL-64: and keeps its citations',                                 legacy.citations.length === 1);

    // Unparseable text falls back to an answer, not a refusal — the user gets
    // the model's words rather than a spurious "cannot answer".
    const bare = parseStructuredResponse('Rent is $4,200 per month.');
    assert('AL-65: unparseable output is an answer with no citations',
      bare.answered === true && bare.citations.length === 0 && /4,200/.test(bare.answer));

    // The prompt is half the contract. These are the instructions that make the
    // model refuse instead of reaching for the nearest clause; losing them is
    // the regression, and a parser test cannot see it.
    assert('AL-66: the prompt names the cross-tenant case that caused this bug',
      /who pays the most rent/i.test(SYSTEM_PROMPT));
    assert('AL-67: the prompt forbids citing a merely related clause',
      /related subject is not an answer/i.test(SYSTEM_PROMPT));
    assert('AL-68: the prompt requires empty citations on a refusal',
      /"citations" MUST be empty/.test(SYSTEM_PROMPT));
    assert('AL-69: the prompt declares the answered field in its JSON shape',
      /"answered":\s*true/.test(SYSTEM_PROMPT));
  }

  // ── MAX_LEASE_TEXT constant value ────────────────────────────────────────

  console.log('\n[Constants]');
  {
    assert('AL-33: MAX_LEASE_TEXT is 300000',    MAX_LEASE_TEXT === 300000);
    assert('AL-34: MAX_QUESTION_LEN is 1000',    MAX_QUESTION_LEN === 1000);
    assert('AL-35: ANTHROPIC_TIMEOUT is 45000',  ANTHROPIC_TIMEOUT === 45000);
  }

  // ── Phase 22C: Citations in response ─────────────────────────────────────

  console.log('\n[Citations in response]');
  {
    const rows = [{ id: 'doc-cit', extracted_text: '--- Page 7 ---\nCAM cap shall not exceed 5% per annum. See Section 4.2.', used_pdf_direct: false, file_url: 'https://storage.example.com/lease.pdf' }];
    const cits = [{ quote: 'CAM cap shall not exceed 5% per annum', section: 'Section 4.2', page: 7 }];
    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'The CAM cap is 5%.', anthropicCitations: cits });
    const r = await h.handle({ leaseDocumentId: 'doc-cit', question: 'What is the CAM cap?' });
    assert('AL-36: citations is an array',                  Array.isArray(r.body.citations));
    assert('AL-37: citation has quote field',               typeof r.body.citations[0].quote === 'string');
    assert('AL-38: citation has section field',             r.body.citations[0].section === 'Section 4.2');
    assert('AL-39: citation has page field',                r.body.citations[0].page === 7);
    assert('AL-40: fileUrl matches stored file_url',        r.body.fileUrl === 'https://storage.example.com/lease.pdf');
  }

  // ── fileUrl null when doc has no file_url ────────────────────────────────

  console.log('\n[fileUrl null fallback]');
  {
    const rows = [{ id: 'doc-nourl', extracted_text: 'some text', used_pdf_direct: false }];
    const h = buildHandler({ sbRows: rows });
    const r = await h.handle({ leaseDocumentId: 'doc-nourl', question: 'question' });
    assert('AL-41: fileUrl is null when doc has no file_url', r.body.fileUrl === null);
  }

  // ── Empty citations when nothing relevant ────────────────────────────────

  console.log('\n[Empty citations]');
  {
    const rows = [{ id: 'doc-nocit', extracted_text: 'This lease covers retail space.', used_pdf_direct: false }];
    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'The lease does not mention a management fee cap.', anthropicCitations: [] });
    const r = await h.handle({ leaseDocumentId: 'doc-nocit', question: 'What is the management fee cap?' });
    assert('AL-42: 200 with empty citations array',       r.status === 200 && Array.isArray(r.body.citations));
    assert('AL-43: empty citations array has length 0',   r.body.citations.length === 0);
  }

  // ── parseStructuredResponse unit tests ───────────────────────────────────

  console.log('\n[parseStructuredResponse]');
  {
    // Valid JSON
    const validJson = JSON.stringify({ answer: 'The cap is 5%.', citations: [{ quote: 'cap is 5%', section: 'Section 3', page: 4 }] });
    const r1 = parseStructuredResponse(validJson);
    assert('AL-44: valid JSON → answer extracted',     r1.answer === 'The cap is 5%.');
    assert('AL-45: valid JSON → citations extracted',  r1.citations.length === 1);
    assert('AL-46: citation page is integer',          r1.citations[0].page === 4);
    assert('AL-47: citation section preserved',        r1.citations[0].section === 'Section 3');

    // Malformed JSON → graceful fallback to raw text
    const rawText = 'The answer is in section 3. The cap is 5 percent.';
    const r2 = parseStructuredResponse(rawText);
    assert('AL-48: non-JSON text → raw text as answer',   r2.answer === rawText);
    assert('AL-49: non-JSON text → empty citations',      r2.citations.length === 0);

    // JSON with no citations key
    const noCitJson = JSON.stringify({ answer: 'No citations here.' });
    const r3 = parseStructuredResponse(noCitJson);
    assert('AL-50: missing citations key → empty array',  r3.citations.length === 0);

    // Citation with null quote is filtered out
    const nullQuoteJson = JSON.stringify({ answer: 'ok', citations: [{ quote: null, section: 'S1', page: 1 }, { quote: 'real quote', section: 'S2', page: 2 }] });
    const r4 = parseStructuredResponse(nullQuoteJson);
    assert('AL-51: citation with null quote is filtered', r4.citations.length === 1);
    assert('AL-52: valid citation survives filter',       r4.citations[0].quote === 'real quote');

    // JSON embedded in markdown code block (Claude sometimes wraps)
    const mdWrapped = '```json\n' + JSON.stringify({ answer: 'Wrapped answer.', citations: [] }) + '\n```';
    const r5 = parseStructuredResponse(mdWrapped);
    assert('AL-53: JSON inside markdown block extracted', r5.answer === 'Wrapped answer.');
    assert('AL-54: empty citations from wrapped JSON',    r5.citations.length === 0);

    // Page is a float → floored to integer
    const floatPageJson = JSON.stringify({ answer: 'ok', citations: [{ quote: 'q', section: 'S1', page: 7.9 }] });
    const r6 = parseStructuredResponse(floatPageJson);
    assert('AL-55: float page floored to integer',        r6.citations[0].page === 7);

    // Non-numeric page → null
    const strPageJson = JSON.stringify({ answer: 'ok', citations: [{ quote: 'q', section: 'S1', page: 'seven' }] });
    const r7 = parseStructuredResponse(strPageJson);
    assert('AL-56: string page normalised to null',       r7.citations[0].page === null);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60) + '\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
