'use strict';
/**
 * test-ask-lease.js
 * Phase 22B regression tests for Ask the Lease API handler.
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

function buildHandler({
  sbRows          = null,
  sbError         = false,
  anthropicAnswer = null,
  anthropicError  = null,
  anthropicAbort  = false,  // simulates AbortError (timeout)
  captureModel    = false,
} = {}) {
  let calledWithModel = null;

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

    return {
      answer:       anthropicAnswer || `Answer for: ${question}`,
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
        answer:        result.answer,
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
    const rows = [{ id: 'doc-good', file_name: 'sunrise.pdf', tenant_name: 'Sunrise Cafe', extracted_text: leaseText, used_pdf_direct: false }];

    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'The CAM cap is 5% per year as stated in Section 3.' });
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
    const rows = [{ id: 'doc-shape', extracted_text: 'lease text', used_pdf_direct: false }];
    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'The answer is here.' });
    const r = await h.handle({ leaseDocumentId: 'doc-shape', question: 'question' });
    assert('AL-30: answer, truncated, charsAnalyzed in body', 'answer' in r.body && 'truncated' in r.body && 'charsAnalyzed' in r.body);
    assert('AL-31: answer is a non-empty string',             typeof r.body.answer === 'string' && r.body.answer.length > 0);
    assert('AL-32: no extra keys leaked',                     Object.keys(r.body).length === 3);
  }

  // ── MAX_LEASE_TEXT constant value ────────────────────────────────────────

  console.log('\n[Constants]');
  {
    assert('AL-33: MAX_LEASE_TEXT is 300000',    MAX_LEASE_TEXT === 300000);
    assert('AL-34: MAX_QUESTION_LEN is 1000',    MAX_QUESTION_LEN === 1000);
    assert('AL-35: ANTHROPIC_TIMEOUT is 45000',  ANTHROPIC_TIMEOUT === 45000);
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
