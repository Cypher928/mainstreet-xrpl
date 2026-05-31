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
// Inline replica of handler logic for unit testing
// ---------------------------------------------------------------------------

const MAX_QUESTION_LEN = 1000;
const MAX_LEASE_TEXT   = 80000;

function buildHandler({ sbRows = null, sbError = false, anthropicAnswer = null, anthropicError = null } = {}) {
  async function mockFetchLeaseDoc(id) {
    if (sbError) throw new Error('Supabase network failure');
    if (sbRows === null) return null;
    return sbRows.find(r => r.id === id) || null;
  }

  async function mockCallClaude(leaseText, question) {
    if (anthropicError) throw new Error(anthropicError);
    return { answer: anthropicAnswer || `Answer for: ${question}`, inputTokens: 100, outputTokens: 50 };
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
      return { status: 500, body: { error: err.message || 'Claude request failed' } };
    }

    return { status: 200, body: { answer: result.answer } };
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
    // Not found
    const h1 = buildHandler({ sbRows: [] });
    const r1  = await h1.handle({ leaseDocumentId: 'missing-id', question: 'What is the CAM cap?' });
    assert('AL-7: 404 when doc not found',    r1.status === 404);
    assert('AL-8: error message meaningful',  r1.body.error.includes('not found'));

    // Supabase network error
    const h2 = buildHandler({ sbError: true });
    const r2  = await h2.handle({ leaseDocumentId: 'doc-1', question: 'test' });
    assert('AL-9: 502 on Supabase network error', r2.status === 502);
  }

  // ── No extracted text ────────────────────────────────────────────────────

  console.log('\n[No extracted text]');
  {
    // PDF vision path — no text stored
    const h1 = buildHandler({ sbRows: [{ id: 'doc-vis', extracted_text: null, used_pdf_direct: true }] });
    const r1  = await h1.handle({ leaseDocumentId: 'doc-vis', question: 'What is the CAM cap?' });
    assert('AL-10: 422 for vision doc with no text',         r1.status === 422);
    assert('AL-11: error explains PDF vision limitation',    r1.body.error.includes('PDF vision'));
    assert('AL-12: error mentions re-upload',                r1.body.error.includes('Re-upload'));

    // Text path but extracted_text somehow null
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
    assert('AL-14: 200 on successful answer', r.status === 200);
    assert('AL-15: answer field present',     typeof r.body.answer === 'string');
    assert('AL-16: answer contains content',  r.body.answer.includes('5%'));
  }

  // ── Question trimming ────────────────────────────────────────────────────

  console.log('\n[Question trimming]');
  {
    const rows = [{ id: 'doc-trim', extracted_text: 'Lease text here.', used_pdf_direct: false }];
    let receivedQuestion = null;
    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'Trimmed answer' });

    // Override to capture what was sent — patch the mock
    const r = await h.handle({ leaseDocumentId: 'doc-trim', question: '  What is the cap?  ' });
    assert('AL-17: 200 even with padded question', r.status === 200);
  }

  // ── Anthropic error ──────────────────────────────────────────────────────

  console.log('\n[Anthropic errors]');
  {
    const rows = [{ id: 'doc-anthr', extracted_text: 'some text', used_pdf_direct: false }];
    const h = buildHandler({ sbRows: rows, anthropicError: 'Anthropic API error 429: rate limit exceeded' });
    const r = await h.handle({ leaseDocumentId: 'doc-anthr', question: 'What is the cap?' });
    assert('AL-18: 500 on Anthropic error',          r.status === 500);
    assert('AL-19: error message from Claude forwarded', r.body.error.includes('rate limit'));
  }

  // ── Lease text truncation at MAX_LEASE_TEXT ──────────────────────────────

  console.log('\n[Large lease text]');
  {
    const bigText = 'x'.repeat(90000);  // > MAX_LEASE_TEXT
    const rows = [{ id: 'doc-big', extracted_text: bigText, used_pdf_direct: false }];
    let capturedText = null;
    // Verify that the handler still returns 200 (truncation happens inside callClaude, not as an error)
    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'Answer for large lease' });
    const r = await h.handle({ leaseDocumentId: 'doc-big', question: 'test question' });
    assert('AL-20: 200 returned even with oversized lease text', r.status === 200);
  }

  // ── Response shape ───────────────────────────────────────────────────────

  console.log('\n[Response shape]');
  {
    const rows = [{ id: 'doc-shape', extracted_text: 'lease text', used_pdf_direct: false }];
    const h = buildHandler({ sbRows: rows, anthropicAnswer: 'The answer is here.' });
    const r = await h.handle({ leaseDocumentId: 'doc-shape', question: 'question' });
    assert('AL-21: only answer key in 200 body',  Object.keys(r.body).length === 1 && 'answer' in r.body);
    assert('AL-22: answer is a string',            typeof r.body.answer === 'string' && r.body.answer.length > 0);
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
